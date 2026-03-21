import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { login, getMe } from '../api/auth';
import { setCredentials } from '../store/authSlice';

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 16, padding: 40, width: 380 },
  title: { fontSize: 28, fontWeight: 700, color: '#7c3aed', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#707080', textAlign: 'center', marginBottom: 32 },
  label: { fontSize: 13, color: '#909090', marginBottom: 6, display: 'block' },
  input: {
    width: '100%', padding: '10px 14px', background: '#0f0f1a', border: '1px solid #3a3a5a',
    borderRadius: 8, color: '#e0e0e0', fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box',
  },
  btn: {
    width: '100%', padding: '12px', background: '#7c3aed', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8,
  },
  error: { color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  link: { textAlign: 'center', marginTop: 20, fontSize: 13, color: '#707080' },
  linkA: { color: '#7c3aed', textDecoration: 'none' },
};

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(username, password);
      const token = res.data.access_token;
      const me = await getMe();
      dispatch(setCredentials({ user: me.data, token }));
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.title}>📈 StockAI</div>
        <div style={S.subtitle}>AI-powered stock & commodity analysis</div>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>Username</label>
          <input style={S.input} value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label style={S.label}>Password</label>
          <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button style={S.btn} type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
        <div style={S.link}>
          Don't have an account? <Link to="/register" style={S.linkA}>Register</Link>
        </div>
      </div>
    </div>
  );
}
