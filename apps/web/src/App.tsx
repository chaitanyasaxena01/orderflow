import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { CartPage } from './pages/CartPage';
import { OrdersPage } from './pages/OrdersPage';
import { InventoryPage } from './pages/InventoryPage';
import { AdminProductsPage } from './pages/AdminProductsPage';

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">OF</span>
          <div>
            <strong>OrderFlow</strong>
            <span className="muted"> portfolio backend demo</span>
          </div>
        </div>
        <nav className="nav">
          <Link to="/">Products</Link>
          {user && <Link to="/cart">Cart</Link>}
          {user && <Link to="/orders">Orders</Link>}
          {user && (user.role === 'STAFF' || user.role === 'ADMIN') && (
            <Link to="/inventory">Inventory</Link>
          )}
          {user && (user.role === 'STAFF' || user.role === 'ADMIN') && (
            <Link to="/admin/products">Manage</Link>
          )}
        </nav>
        <div className="user-area">
          {user ? (
            <>
              <span className="pill">{user.role}</span>
              <span className="muted">{user.firstName}</span>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <Link className="btn primary" to="/login">
              Log in
            </Link>
          )}
        </div>
      </header>
      <main className="main">{children}</main>
      <footer className="footer">
        <span>API docs: </span>
        <a href="http://localhost:4000/docs" target="_blank" rel="noreferrer">
          /docs
        </a>
      </footer>
    </div>
  );
}

function Private({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<ProductsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/cart"
          element={
            <Private>
              <CartPage />
            </Private>
          }
        />
        <Route
          path="/orders"
          element={
            <Private>
              <OrdersPage />
            </Private>
          }
        />
        <Route
          path="/inventory"
          element={
            <Private>
              <InventoryPage />
            </Private>
          }
        />
        <Route
          path="/admin/products"
          element={
            <Private>
              <AdminProductsPage />
            </Private>
          }
        />
      </Routes>
    </Shell>
  );
}
