import { useEffect, useState } from 'react';
import { api, money, type Order } from '../api';
import { useAuth } from '../auth';

export function OrdersPage() {
  const { accessToken } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api.orders(accessToken);
      setOrders(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [accessToken]);

  async function pay(order: Order, event: 'payment.succeeded' | 'payment.failed') {
    if (!order.payment) return;
    setBusy(order.id + event);
    setError(null);
    setMessage(null);
    try {
      await api.simulatePayment(order.payment.id, order.id, event);
      setMessage(
        event === 'payment.succeeded'
          ? 'Simulated payment success'
          : 'Simulated payment failure (inventory released)',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="muted">Loading orders…</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Orders</h1>
        <p className="muted">
          Simulate signed payment webhooks locally (requires VITE_PAYMENT_WEBHOOK_SECRET).
        </p>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      {orders.length === 0 ? (
        <p className="empty">No orders yet.</p>
      ) : (
        <div className="stack">
          {orders.map((order) => (
            <article key={order.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <div className="sku">{order.id}</div>
                  <h2 style={{ marginTop: '0.35rem' }}>{money(order.totalCents)}</h2>
                  <div className="muted">{new Date(order.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="status">{order.status}</div>
                  {order.payment && (
                    <div className="muted" style={{ marginTop: '0.35rem' }}>
                      payment: {order.payment.status}
                    </div>
                  )}
                </div>
              </div>
              {order.items && order.items.length > 0 && (
                <ul className="muted">
                  {order.items.map((i, idx) => (
                    <li key={idx}>
                      {i.quantity}× {i.productName} ({money(i.unitPriceCents)})
                    </li>
                  ))}
                </ul>
              )}
              {order.status === 'PENDING_PAYMENT' && order.payment && (
                <div className="row-actions" style={{ marginTop: '0.75rem' }}>
                  <button
                    className="btn ok"
                    type="button"
                    disabled={!!busy}
                    onClick={() => void pay(order, 'payment.succeeded')}
                  >
                    Simulate pay success
                  </button>
                  <button
                    className="btn warn"
                    type="button"
                    disabled={!!busy}
                    onClick={() => void pay(order, 'payment.failed')}
                  >
                    Simulate pay failure
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
