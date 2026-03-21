import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { setUser } from '../store/authSlice';
import client from '../api/client';

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 600 },
  card: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 12, padding: 28, marginBottom: 20 },
  title: { fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginBottom: 20 },
  label: { fontSize: 13, color: '#909090', marginBottom: 6, display: 'block' },
  input: {
    width: '100%', padding: '10px 14px', background: '#0f0f1a', border: '1px solid #3a3a5a',
    borderRadius: 8, color: '#e0e0e0', fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '10px 14px', background: '#0f0f1a', border: '1px solid #3a3a5a',
    borderRadius: 8, color: '#e0e0e0', fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box',
  },
  btn: {
    padding: '10px 24px', background: '#7c3aed', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  success: { color: '#22c55e', fontSize: 13, marginTop: 12 },
  error: { color: '#ef4444', fontSize: 13, marginTop: 12 },
  hint: { fontSize: 12, color: '#606070', marginTop: -12, marginBottom: 16, lineHeight: 1.5 },
};

export default function Profile() {
  const dispatch = useDispatch();
  const user = useSelector((s: RootState) => s.auth.user);
  const [form, setForm] = useState({
    budget: user?.budget?.toString() || '',
    investment_style: user?.investment_style || '',
    time_horizon: user?.time_horizon || '',
    risk_tolerance: user?.risk_tolerance || '',
    telegram_chat_id: user?.telegram_chat_id || '',
  });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(''); setError('');
    try {
      const payload: any = { ...form };
      if (form.budget) payload.budget = parseFloat(form.budget);
      else delete payload.budget;
      const res = await client.put('/users/profile', payload);
      dispatch(setUser(res.data));
      setStatus('Profile saved!');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Save failed');
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.title}>👤 Investment Profile</div>
        <p style={{ fontSize: 13, color: '#707080', marginBottom: 20 }}>
          Your investment profile is used by the AI to personalize stock recommendations.
        </p>
        <form onSubmit={handleSave}>
          <label style={S.label}>Investment Budget (USD)</label>
          <input style={S.input} type="number" placeholder="e.g. 10000"
            value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />

          <label style={S.label}>Investment Style</label>
          <select style={S.select} value={form.investment_style}
            onChange={(e) => setForm({ ...form, investment_style: e.target.value })}>
            <option value="">Select style...</option>
            <option value="growth">Growth — High-growth companies</option>
            <option value="value">Value — Undervalued companies</option>
            <option value="dividend">Dividend — Income-focused</option>
            <option value="speculative">Speculative — High risk/reward</option>
          </select>

          <label style={S.label}>Time Horizon</label>
          <select style={S.select} value={form.time_horizon}
            onChange={(e) => setForm({ ...form, time_horizon: e.target.value })}>
            <option value="">Select horizon...</option>
            <option value="short">Short-term (days to weeks)</option>
            <option value="medium">Medium-term (months)</option>
            <option value="long">Long-term (years)</option>
          </select>

          <label style={S.label}>Risk Tolerance</label>
          <select style={S.select} value={form.risk_tolerance}
            onChange={(e) => setForm({ ...form, risk_tolerance: e.target.value })}>
            <option value="">Select risk level...</option>
            <option value="conservative">Conservative — Preserve capital</option>
            <option value="moderate">Moderate — Balanced approach</option>
            <option value="aggressive">Aggressive — Maximize returns</option>
          </select>

          <label style={S.label}>Telegram Chat ID</label>
          <input style={S.input} placeholder="e.g. 123456789"
            value={form.telegram_chat_id}
            onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })} />
          <p style={S.hint}>
            Send /start to your bot to get your chat ID. Required for Telegram notifications.
          </p>

          <button style={S.btn} type="submit">Save Profile</button>
          {status && <div style={S.success}>{status}</div>}
          {error && <div style={S.error}>{error}</div>}
        </form>
      </div>

      <div style={S.card}>
        <div style={S.title}>ℹ️ Account Info</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['Username', user?.username],
              ['Email', user?.email],
              ['Member since', user?.created_at ? new Date(user.created_at).toLocaleDateString() : ''],
            ].map(([k, v]) => (
              <tr key={k as string} style={{ borderBottom: '1px solid #2a2a4a' }}>
                <td style={{ padding: '8px 0', fontSize: 13, color: '#909090', width: '40%' }}>{k}</td>
                <td style={{ padding: '8px 0', fontSize: 14, color: '#e0e0e0' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
