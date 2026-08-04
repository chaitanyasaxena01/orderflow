import { z } from 'zod';

export const emailSchema = z.string().email().max(255).transform((v) => v.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const createProductSchema = z.object({
  sku: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'SKU must be alphanumeric with - or _'),
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(5000).default(''),
  priceCents: z.number().int().positive('Price must be a positive integer (cents)'),
  category: z.string().min(1).max(100).default('general'),
  initialQuantity: z.number().int().min(0).default(0),
});

export const updateProductSchema = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    description: z.string().max(5000).optional(),
    priceCents: z.number().int().positive().optional(),
    category: z.string().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(1000),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().positive().max(1000),
});

export const restockSchema = z.object({
  quantity: z.number().int().positive(),
  reason: z.string().max(500).default('restock'),
});

export const adjustInventorySchema = z.object({
  availableQuantity: z.number().int().min(0).optional(),
  reason: z.string().max(500).default('manual adjustment'),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const productListQuerySchema = paginationSchema.extend({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  sortBy: z.enum(['createdAt', 'name', 'priceCents']).default('createdAt'),
});

export const paymentWebhookPayloadSchema = z.object({
  event: z.enum(['payment.succeeded', 'payment.failed', 'payment.refunded']),
  paymentId: z.string().uuid(),
  orderId: z.string().uuid(),
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CartItemInput = z.infer<typeof cartItemSchema>;
export type PaymentWebhookPayload = z.infer<typeof paymentWebhookPayloadSchema>;
