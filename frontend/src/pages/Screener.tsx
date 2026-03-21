import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { runScreener } from '../api/stocks';
import { ScreenerResult } from '../types';
import { formatCurrency } from '../utils/formatters';

const S: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#e0e0e0', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#707080' },
  btn: {
    padding: '10px 24px', background: '#7c3aed', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 16,
  },
  card: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 12, overflow: 'hidden' },
  row: { padding: '14px 20px', borderBottom: '1px solid #1e1e2e', display: 'flex', alignItems: 'center', gap: 16 },
  ticker: { fontWeight: 700, color: '#7c3aed', fontSize: 16, minWidth: 80, textDecoration: 'none' },
  name: { fontSize: 13, color: '#909090', flex: 1 },
  price: { fontSize: 14, fontWeight: 600, color: '#e0e0e0', minWidth: 80 },
  rsi: { fontSize: 13, minWidth: 80 },
  signals: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  signal: {
    padding: '2px 10px', background: 'rgba(124,58,237,0.15)',
    color: '#a78bfa', borderRadius: 12, fontSize: 11, border: '1px solid rgba(124,58,237,0.3)',
  },
  empty: { textAlign: 'center', padding: 40, color: '#606070', fontSize: 14 },
  loading: { textAlign: 'center', padding: 40, color: '#7c3aed' },
};

export default function Screener() {
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  const handleScan = async () => {
    setLoading(true);
    setRan(true);
    try {
      const res = await runScreener();
      setResults(res.data);
    } catch {}
    setLoading(false);
  };

  return (
    <div>
      <div style={S.header}>
        <div style={S.title}>🔍 Market Screener</div>
        <div style={S.subtitle}>
          Scans your watchlist for technical signals: RSI extremes, MACD crossovers, SMA crosses, volume spikes.
        </div>
        <button style={S.btn} onClick={handleScan} disabled={loading}>
          {loading ? '⏳ Scanning...' : '▶ Run Screener'}
        </button>
      </div>

      {loading && <div style={S.loading}>Analyzing your watchlist...</div>}

      {!loading && ran && results.length === 0 && (
        <div style={{ ...S.card }}>
          <div style={S.empty}>No screener signals found for your watchlist. Markets may be quiet today.</div>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div style={S.card}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a4a', fontSize: 13, color: '#707080' }}>
            {results.length} signal{results.length !== 1 ? 's' : ''} found
          </div>
          {results.map((r) => {
            const rsiColor = r.rsi != null ? (r.rsi > 70 ? '#ef4444' : r.rsi < 30 ? '#22c55e' : '#909090') : '#909090';
            return (
              <div key={r.ticker} style={S.row}>
                <Link to={`/stock/${r.ticker}`} style={S.ticker}>{r.ticker}</Link>
                <span style={S.name}>{r.company_name || '—'}</span>
                <span style={S.price}>{r.price ? formatCurrency(r.price) : '—'}</span>
                {r.rsi != null && (
                  <span style={{ ...S.rsi, color: rsiColor }}>RSI {r.rsi.toFixed(1)}</span>
                )}
                <div style={S.signals}>
                  {r.signals.map((sig, i) => (
                    <span key={i} style={S.signal}>{sig}</span>
                  ))}
                </div>
                <Link
                  to={`/stock/${r.ticker}`}
                  style={{ padding: '4px 12px', background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid #7c3aed', borderRadius: 6, cursor: 'pointer', fontSize: 12, textDecoration: 'none' }}
                >
                  Analyze →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
