const API_URL = import.meta.env.VITE_API_URL ?? '';

export type ApiError = {
  success: false;
  error: { code: string; message: string; requestId?: string };
};

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as ApiError)?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{
      success: true;
      data: {
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string; firstName: string; role: string };
      };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  products: (token?: string | null) =>
    request<{ success: true; data: Product[] }>('/api/v1/products?limit=50', {
      token,
    }),

  createProduct: (
    token: string,
    data: {
      sku: string;
      name: string;
      description?: string;
      priceCents: number;
      category?: string;
      initialQuantity?: number;
    },
  ) =>
    request<{ success: true; data: Product }>('/api/v1/products', {
      method: 'POST',
      token,
      body: JSON.stringify(data),
    }),

  inventory: (token: string) =>
    request<{ success: true; data: InventoryRow[] }>('/api/v1/inventory?limit=50', {
      token,
    }),

  cart: (token: string) =>
    request<{ success: true; data: Cart }>('/api/v1/cart', { token }),

  addToCart: (token: string, productId: string, quantity: number) =>
    request<{ success: true; data: Cart }>('/api/v1/cart/items', {
      method: 'POST',
      token,
      body: JSON.stringify({ productId, quantity }),
    }),

  checkout: (token: string, idempotencyKey: string) =>
    request<{ success: true; data: Order }>('/api/v1/checkout', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({}),
    }),

  orders: (token: string) =>
    request<{ success: true; data: Order[] }>('/api/v1/orders?limit=50', { token }),

  simulatePayment: async (
    paymentId: string,
    orderId: string,
    event: 'payment.succeeded' | 'payment.failed',
  ) => {
    // Frontend demo calls a thin backend path via public webhook is not possible without secret.
    // We expose a demo helper on the API that staff/admin can use — for the demo we call
    // the same webhook endpoint only when VITE_PAYMENT_WEBHOOK_SECRET is set (local only).
    const secret = import.meta.env.VITE_PAYMENT_WEBHOOK_SECRET as string | undefined;
    if (!secret) {
      throw new Error(
        'Set VITE_PAYMENT_WEBHOOK_SECRET in apps/web/.env for local payment simulation, or use the CLI script.',
      );
    }

    const body = JSON.stringify({ event, paymentId, orderId });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`));
    const signature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return request('/api/v1/webhooks/payments', {
      method: 'POST',
      headers: {
        'x-payment-signature': signature,
        'x-payment-timestamp': timestamp,
        'x-payment-event-id': `evt_${crypto.randomUUID()}`,
      },
      body,
    });
  },
};

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  category: string;
  isActive: boolean;
  inventory?: {
    availableQuantity: number;
    reservedQuantity: number;
    soldQuantity: number;
  };
}

export interface InventoryRow {
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
  product?: { sku: string; name: string };
}

export interface Cart {
  id: string;
  items: Array<{
    productId: string;
    name: string;
    sku: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  subtotalCents: number;
  totalCents: number;
  itemCount: number;
}

export interface Order {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  payment?: { id: string; status: string; amountCents: number };
  items?: Array<{ productName: string; quantity: number; unitPriceCents: number }>;
}

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
}
