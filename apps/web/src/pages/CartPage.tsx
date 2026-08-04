import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money, type Cart } from '../api';
import { useAuth } from '../auth';

export function CartPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    api
      .cart(accessToken)
      .then((res) => setCart(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load cart'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  async function checkout() {
    if (!accessToken) return;
    setCheckingOut(true);
    setError(null);
    try {
      const key = crypto.randomUUID();
      await api.checkout(accessToken, key);
      navigate('/orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setCheckingOut(false);
    }
  }

  if (loading) return <p className="muted">Loading cart…</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Cart</h1>
        <p className="muted">Totals are always recalculated on the server from product prices.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {!cart || cart.items.length === 0 ? (
        <p className="empty">Your cart is empty.</p>
      ) : (
        <div className="card stack">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {cart.items.map((item) => (
                <tr key={item.productId}>
                  <td>
                    {item.name}
                    <div className="sku">{item.sku}</div>
                  </td>
                  <td>{item.quantity}</td>
                  <td>{money(item.unitPriceCents)}</td>
                  <td>{money(item.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Total {money(cart.totalCents)}</strong>
            <button
              className="btn primary"
              type="button"
              disabled={checkingOut}
              onClick={() => void checkout()}
            >
              {checkingOut ? 'Checking out…' : 'Checkout'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
