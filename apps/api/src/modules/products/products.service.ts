import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildPaginationMeta } from '../../lib/response.js';
import type { CreateProductInput, UpdateProductInput } from '@orderflow/shared';
import { Prisma } from '@prisma/client';

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

  if (query.category) {
    where.category = query.category;
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  // Full-text + ILIKE hybrid search when q is present (uses FTS index when available).
  if (query.q && query.q.trim().length > 0) {
    const q = query.q.trim();
    const skip = (query.page - 1) * query.limit;
    const like = `%${q}%`;
    try {
      const filters: Prisma.Sql[] = [
        Prisma.sql`p.archived_at IS NULL`,
        Prisma.sql`(
          to_tsvector('english', coalesce(p.name, '') || ' ' || coalesce(p.description, ''))
            @@ plainto_tsquery('english', ${q})
          OR p.name ILIKE ${like}
          OR p.description ILIKE ${like}
        )`,
      ];
      if (query.category) {
        filters.push(Prisma.sql`p.category = ${query.category}`);
      }
      if (query.isActive !== undefined) {
        filters.push(Prisma.sql`p.is_active = ${query.isActive}`);
      }

      const whereSql = Prisma.join(filters, ' AND ');

      const rows = await prisma.$queryRaw<Array<{ id: string; total: bigint }>>`
        SELECT p.id, COUNT(*) OVER() AS total
        FROM products p
        WHERE ${whereSql}
        ORDER BY
          ts_rank(
            to_tsvector('english', coalesce(p.name, '') || ' ' || coalesce(p.description, '')),
            plainto_tsquery('english', ${q})
          ) DESC,
          p.created_at DESC
        LIMIT ${query.limit}
        OFFSET ${skip}
      `;

      const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) {
        return {
          products: [],
          meta: buildPaginationMeta(query.page, query.limit, 0),
        };
      }

      const products = await prisma.product.findMany({
        where: { id: { in: ids } },
        include: { inventory: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      const ordered = ids.map((id) => byId.get(id)!).filter(Boolean);

      return {
        products: ordered.map(serializeProduct),
        meta: buildPaginationMeta(query.page, query.limit, total),
      };
    } catch {
      // FTS unavailable — fall through to ILIKE
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
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
