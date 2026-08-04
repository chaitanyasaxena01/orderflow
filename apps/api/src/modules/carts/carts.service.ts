import { lineTotalCents, sumCents } from '@orderflow/shared';
import { prisma } from '../../lib/prisma.js';
import {
  AppError,
  InsufficientInventoryError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';

async function getOrCreateActiveCart(userId: string) {
  let cart = await prisma.cart.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: {
      items: {
        include: {
          product: {
            include: { inventory: true },
          },
        },
      },
    },
  });

  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId, status: 'ACTIVE' },
      include: {
        items: {
          include: {
            product: {
              include: { inventory: true },
            },
          },
        },
      },
    });
  }

  return cart;
}

function serializeCart(
  cart: Awaited<ReturnType<typeof getOrCreateActiveCart>>,
) {
  const items = cart.items.map((item) => {
    const unitPriceCents = item.product.priceCents;
    const lineTotal = lineTotalCents(unitPriceCents, item.quantity);
    return {
      productId: item.productId,
      sku: item.product.sku,
      name: item.product.name,
      quantity: item.quantity,
      unitPriceCents,
      lineTotalCents: lineTotal,
      availableQuantity: item.product.inventory?.availableQuantity ?? 0,
      isActive: item.product.isActive && !item.product.archivedAt,
    };
  });

  const subtotalCents = sumCents(items.map((i) => i.lineTotalCents));

  return {
    id: cart.id,
    status: cart.status,
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotalCents,
    totalCents: subtotalCents,
    currency: 'USD',
    updatedAt: cart.updatedAt.toISOString(),
  };
}

export async function getCart(userId: string) {
  const cart = await getOrCreateActiveCart(userId);
  return serializeCart(cart);
}

export async function addItem(userId: string, productId: string, quantity: number) {
  const product = await prisma.product.findFirst({
    where: { id: productId, archivedAt: null, isActive: true },
    include: { inventory: true },
  });
  if (!product) {
    throw new NotFoundError('Product not found or inactive');
  }

  const available = product.inventory?.availableQuantity ?? 0;
  if (available < quantity) {
    throw new InsufficientInventoryError(
      `Only ${available} units available for ${product.name}`,
    );
  }

  const cart = await getOrCreateActiveCart(userId);
  const existing = cart.items.find((i) => i.productId === productId);
  const newQty = (existing?.quantity ?? 0) + quantity;

  if (available < newQty) {
    throw new InsufficientInventoryError(
      `Only ${available} units available for ${product.name}`,
    );
  }

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: newQty },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId, quantity },
    });
  }

  return getCart(userId);
}

export async function updateItem(userId: string, productId: string, quantity: number) {
  if (quantity <= 0) {
    throw new ValidationError('quantity must be positive; use DELETE to remove items');
  }

  const cart = await getOrCreateActiveCart(userId);
  const existing = cart.items.find((i) => i.productId === productId);
  if (!existing) {
    throw new NotFoundError('Cart item not found');
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, archivedAt: null, isActive: true },
    include: { inventory: true },
  });
  if (!product) {
    throw new AppError('PRODUCT_UNAVAILABLE', 'Product is no longer available', 409);
  }

  const available = product.inventory?.availableQuantity ?? 0;
  if (available < quantity) {
    throw new InsufficientInventoryError(
      `Only ${available} units available for ${product.name}`,
    );
  }

  await prisma.cartItem.update({
    where: { id: existing.id },
    data: { quantity },
  });

  return getCart(userId);
}

export async function removeItem(userId: string, productId: string) {
  const cart = await getOrCreateActiveCart(userId);
  const existing = cart.items.find((i) => i.productId === productId);
  if (!existing) {
    throw new NotFoundError('Cart item not found');
  }

  await prisma.cartItem.delete({ where: { id: existing.id } });
  return getCart(userId);
}

export async function clearCart(userId: string) {
  const cart = await getOrCreateActiveCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return getCart(userId);
}
