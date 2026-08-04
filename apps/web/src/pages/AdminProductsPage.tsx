import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

export function AdminProductsPage() {
  const { accessToken, user } = useAuth();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceDollars, setPriceDollars] = useState('19.99');
  const [initialQuantity, setInitialQuantity] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user?.role !== 'STAFF' && user?.role !== 'ADMIN') {
    return <div className="error">Staff or admin role required</div>;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const priceCents = Math.round(parseFloat(priceDollars) * 100);
      await api.createProduct(accessToken, {
        sku,
        name,
        description,
        priceCents,
        initialQuantity: parseInt(initialQuantity, 10) || 0,
      });
      setMessage(`Created product ${sku}`);
      setSku('');
      setName('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Create product</h1>
        <p className="muted">STAFF and ADMIN can manage the catalog.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <form className="card form" onSubmit={onSubmit} style={{ maxWidth: 520 }}>
        <label>
          SKU
          <input value={sku} onChange={(e) => setSku(e.target.value)} required />
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        <label>
          Price (USD)
          <input
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
            type="number"
            min="0.01"
            step="0.01"
            required
          />
        </label>
        <label>
          Initial quantity
          <input
            value={initialQuantity}
            onChange={(e) => setInitialQuantity(e.target.value)}
            type="number"
            min="0"
          />
        </label>
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create product'}
        </button>
      </form>
    </div>
  );
}
