import { useEffect, useState } from 'react';
import { api, type InventoryRow } from '../api';
import { useAuth } from '../auth';

export function InventoryPage() {
  const { accessToken, user } = useAuth();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    if (user?.role !== 'STAFF' && user?.role !== 'ADMIN') {
      setError('Staff or admin role required');
      setLoading(false);
      return;
    }
    api
      .inventory(accessToken)
      .then((res) => setRows(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [accessToken, user]);

  if (loading) return <p className="muted">Loading inventory…</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
        <p className="muted">Available, reserved, and sold quantities per product.</p>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Available</th>
              <th>Reserved</th>
              <th>Sold</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <td>
                  {r.product?.name ?? r.productId}
                  <div className="sku">{r.product?.sku}</div>
                </td>
                <td>{r.availableQuantity}</td>
                <td>{r.reservedQuantity}</td>
                <td>{r.soldQuantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
