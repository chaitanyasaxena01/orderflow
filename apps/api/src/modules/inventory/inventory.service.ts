import { prisma } from '../../lib/prisma.js';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { buildPaginationMeta } from '../../lib/response.js';

function serializeInventory(inv: {
  id: string;
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
  version: number;
  updatedAt: Date;
  product?: { sku: string; name: string };
}) {
  return {
    id: inv.id,
    productId: inv.productId,
    availableQuantity: inv.availableQuantity,
    reservedQuantity: inv.reservedQuantity,
    soldQuantity: inv.soldQuantity,
    version: inv.version,
    updatedAt: inv.updatedAt.toISOString(),
    product: inv.product
      ? { sku: inv.product.sku, name: inv.product.name }
      : undefined,
  };
}

export async function listInventory(page: number, limit: number) {
  const where = { product: { archivedAt: null } };
  const [total, rows] = await Promise.all([
    prisma.inventory.count({ where }),
    prisma.inventory.findMany({
      where,
      include: { product: { select: { sku: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    inventory: rows.map(serializeInventory),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function getInventory(productId: string) {
  const inv = await prisma.inventory.findUnique({
    where: { productId },
    include: { product: { select: { sku: true, name: true } } },
  });
  if (!inv) {
    throw new NotFoundError('Inventory not found for product');
  }
  return serializeInventory(inv);
}

export async function restock(productId: string, quantity: number, reason: string) {
  if (quantity <= 0) {
    throw new ValidationError('quantity must be positive');
  }

  return prisma.$transaction(async (tx) => {
    const inv = await tx.inventory.findUnique({ where: { productId } });
    if (!inv) {
      throw new NotFoundError('Inventory not found for product');
    }

    const updated = await tx.inventory.update({
      where: { productId },
      data: {
        availableQuantity: { increment: quantity },
        version: { increment: 1 },
      },
      include: { product: { select: { sku: true, name: true } } },
    });

    await tx.inventoryAdjustment.create({
      data: {
        productId,
        inventoryId: inv.id,
        type: 'RESTOCK',
        quantityDelta: quantity,
        reason,
      },
    });

    return serializeInventory(updated);
  });
}

export async function adjustInventory(
  productId: string,
  availableQuantity: number | undefined,
  reason: string,
) {
  if (availableQuantity === undefined) {
    throw new ValidationError('availableQuantity is required');
  }
  if (availableQuantity < 0) {
    throw new AppError('INVALID_INVENTORY', 'availableQuantity cannot be negative', 400);
  }

  return prisma.$transaction(async (tx) => {
    const inv = await tx.inventory.findUnique({ where: { productId } });
    if (!inv) {
      throw new NotFoundError('Inventory not found for product');
    }

    const delta = availableQuantity - inv.availableQuantity;

    const updated = await tx.inventory.update({
      where: { productId },
      data: {
        availableQuantity,
        version: { increment: 1 },
      },
      include: { product: { select: { sku: true, name: true } } },
    });

    await tx.inventoryAdjustment.create({
      data: {
        productId,
        inventoryId: inv.id,
        type: 'ADJUSTMENT',
        quantityDelta: delta,
        reason,
      },
    });

    return serializeInventory(updated);
  });
}

/**
 * Atomically reserve inventory. Returns true if reservation succeeded.
 * Uses conditional update to prevent overselling under concurrency.
 */
export async function reserveInventory(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productId: string,
  quantity: number,
): Promise<boolean> {
  const result = await tx.$executeRaw`
    UPDATE inventory
    SET available_quantity = available_quantity - ${quantity},
        reserved_quantity = reserved_quantity + ${quantity},
        version = version + 1,
        updated_at = NOW()
    WHERE product_id = ${productId}::uuid
      AND available_quantity >= ${quantity}
  `;
  return result === 1;
}

export async function releaseReservation(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE inventory
    SET available_quantity = available_quantity + ${quantity},
        reserved_quantity = GREATEST(0, reserved_quantity - ${quantity}),
        version = version + 1,
        updated_at = NOW()
    WHERE product_id = ${productId}::uuid
  `;
}

export async function listAdjustments(productId: string, page: number, limit: number) {
  const inv = await prisma.inventory.findUnique({ where: { productId } });
  if (!inv) {
    throw new NotFoundError('Inventory not found for product');
  }

  const where = { productId };
  const [total, rows] = await Promise.all([
    prisma.inventoryAdjustment.count({ where }),
    prisma.inventoryAdjustment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    adjustments: rows.map((r) => ({
      id: r.id,
      type: r.type,
      quantityDelta: r.quantityDelta,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    })),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function convertReservationToSold(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE inventory
    SET reserved_quantity = GREATEST(0, reserved_quantity - ${quantity}),
        sold_quantity = sold_quantity + ${quantity},
        version = version + 1,
        updated_at = NOW()
    WHERE product_id = ${productId}::uuid
  `;
}
