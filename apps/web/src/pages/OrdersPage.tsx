import { useEffect, useState } from 'react';
import { api, money, orderTimeline, type Order } from '../api';
import { useAuth } from '../auth';

export function OrdersPage() {
  const { accessToken, user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const canFulfill = user?.role === 'STAFF' || user?.role === 'ADMIN';

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

  async function fulfill(order: Order, action: 'process' | 'ship' | 'complete') {
    if (!accessToken) return;
    setBusy(order.id + action);
    setError(null);
    try {
      await api.fulfill(accessToken, order.id, action);
      setMessage(`Order ${action}ed`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fulfillment failed');
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
          Status timeline, payment simulation, and staff fulfillment actions.
        </p>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      {orders.length === 0 ? (
        <p className="empty">No orders yet. Add items to your cart and checkout.</p>
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

              <div className="timeline" style={{ marginTop: '0.85rem' }}>
                {orderTimeline(order.status).map((step) => (
                  <span
                    key={step.label}
                    className={`timeline-step ${step.done ? 'done' : ''}`}
                  >
                    {step.label}
                  </span>
                ))}
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
              {canFulfill && (
                <div className="row-actions" style={{ marginTop: '0.75rem' }}>
                  {order.status === 'PAID' && (
                    <button
                      className="btn primary"
                      type="button"
                      disabled={!!busy}
                      onClick={() => void fulfill(order, 'process')}
                    >
                      Mark processing
                    </button>
                  )}
                  {order.status === 'PROCESSING' && (
                    <button
                      className="btn primary"
                      type="button"
                      disabled={!!busy}
                      onClick={() => void fulfill(order, 'ship')}
                    >
                      Mark shipped
                    </button>
                  )}
                  {order.status === 'SHIPPED' && (
                    <button
                      className="btn ok"
                      type="button"
                      disabled={!!busy}
                      onClick={() => void fulfill(order, 'complete')}
                    >
                      Mark completed
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
