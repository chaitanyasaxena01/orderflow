import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('customer@orderflow.dev');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate('/');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card login-card">
      <div className="page-header">
        <h1>Sign in</h1>
        <p className="muted">Use a demo account from the seed data.</p>
      </div>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={onSubmit}>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="demo-hint">
        <div>
          Customer: <code>customer@orderflow.dev</code>
        </div>
        <div>
          Staff: <code>staff@orderflow.dev</code>
        </div>
        <div>
          Admin: <code>admin@orderflow.dev</code>
        </div>
        <div>
          Password: <code>Password123!</code>
        </div>
      </div>
    </div>
  );
}
