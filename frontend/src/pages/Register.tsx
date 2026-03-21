import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../api/auth';

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 16, padding: 40, width: 380 },
  title: { fontSize: 24, fontWeight: 700, color: '#7c3aed', textAlign: 'center', marginBottom: 28 },
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
  success: { color: '#22c55e', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  link: { textAlign: 'center', marginTop: 20, fontSize: 13, color: '#707080' },
  linkA: { color: '#7c3aed', textDecoration: 'none' },
};

export default function Register() {
  const [form, setForm] = useState({ email: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form.email, form.username, form.password);
      setSuccess('Account created! Redirecting...');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.title}>Create Account</div>
        {error && <div style={S.error}>{error}</div>}
        {success && <div style={S.success}>{success}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>Email</label>
          <input style={S.input} type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <label style={S.label}>Username</label>
          <input style={S.input} value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          <label style={S.label}>Password</label>
          <input style={S.input} type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <button style={S.btn} type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>
        <div style={S.link}>
          Already have an account? <Link to="/login" style={S.linkA}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
