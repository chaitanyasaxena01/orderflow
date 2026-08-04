import { useEffect, useState } from 'react';
import { api, money, type Product } from '../api';
import { useAuth } from '../auth';

export function ProductsPage() {
  const { accessToken, user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .products(accessToken)
      .then((res) => setProducts(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  async function add(productId: string) {
    if (!accessToken) {
      setError('Log in as a customer to add items to the cart.');
      return;
    }
    setBusyId(productId);
    setError(null);
    setMessage(null);
    try {
      await api.addToCart(accessToken, productId, 1);
      setMessage('Added to cart');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to cart');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Products</h1>
        <p className="muted">Server-priced catalog with inventory-aware cart actions.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      {loading ? (
        <p className="muted">Loading products…</p>
      ) : products.length === 0 ? (
        <p className="empty">No products yet. Seed the database or create products as staff.</p>
      ) : (
        <div className="grid">
          {products.map((p) => (
            <article key={p.id} className="card">
              <div className="sku">{p.sku}</div>
              <h3>{p.name}</h3>
              <p className="muted" style={{ minHeight: '2.6em' }}>
                {p.description || p.category}
              </p>
              <div className="price">{money(p.priceCents)}</div>
              <div className="stock">
                {p.inventory
                  ? `${p.inventory.availableQuantity} available`
                  : 'Inventory n/a'}
              </div>
              <button
                className="btn primary"
                type="button"
                disabled={!!busyId || !user}
                onClick={() => void add(p.id)}
              >
                {busyId === p.id ? 'Adding…' : user ? 'Add to cart' : 'Log in to buy'}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
