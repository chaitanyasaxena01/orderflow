import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildPaginationMeta } from '../../lib/response.js';
import type { CreateProductInput, UpdateProductInput } from '@orderflow/shared';
import type { Prisma } from '@prisma/client';

function serializeProduct(
  product: {
    id: string;
    sku: string;
    name: string;
    description: string;
    priceCents: number;
    category: string;
    isActive: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    inventory?: {
      availableQuantity: number;
      reservedQuantity: number;
      soldQuantity: number;
    } | null;
  },
) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    category: product.category,
    isActive: product.isActive,
    archivedAt: product.archivedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    inventory: product.inventory
      ? {
          availableQuantity: product.inventory.availableQuantity,
          reservedQuantity: product.inventory.reservedQuantity,
          soldQuantity: product.inventory.soldQuantity,
        }
      : undefined,
  };
}

export async function listProducts(query: {
  page: number;
  limit: number;
  sortBy: 'createdAt' | 'name' | 'priceCents';
  sortOrder: 'asc' | 'desc';
  q?: string;
  category?: string;
  isActive?: boolean;
}) {
  const where: Prisma.ProductWhereInput = {
    archivedAt: null,
  };

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  if (query.category) {
    where.category = query.category;
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { inventory: true },
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return {
    products: products.map(serializeProduct),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function getProduct(id: string) {
  const product = await prisma.product.findFirst({
    where: { id, archivedAt: null },
    include: { inventory: true },
  });
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  return serializeProduct(product);
}

export async function createProduct(input: CreateProductInput) {
  const existing = await prisma.product.findUnique({ where: { sku: input.sku } });
  if (existing) {
    throw new ConflictError('SKU_EXISTS', 'A product with this SKU already exists');
  }

  const product = await prisma.product.create({
    data: {
      sku: input.sku,
      name: input.name,
      description: input.description ?? '',
      priceCents: input.priceCents,
      category: input.category ?? 'general',
      inventory: {
        create: {
          availableQuantity: input.initialQuantity ?? 0,
          reservedQuantity: 0,
          soldQuantity: 0,
        },
      },
    },
    include: { inventory: true },
  });

  return serializeProduct(product);
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  const existing = await prisma.product.findFirst({
    where: { id, archivedAt: null },
  });
  if (!existing) {
    throw new NotFoundError('Product not found');
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: { inventory: true },
  });

  return serializeProduct(product);
}

export async function archiveProduct(id: string) {
  const existing = await prisma.product.findFirst({
    where: { id, archivedAt: null },
  });
  if (!existing) {
    throw new NotFoundError('Product not found');
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      isActive: false,
      archivedAt: new Date(),
    },
    include: { inventory: true },
  });

  return serializeProduct(product);
}
