import React from 'react';
import { AIRecommendation as AIRec } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

const colors = { BUY: '#22c55e', SELL: '#ef4444', HOLD: '#f59e0b' };
const emojis = { BUY: '🟢', SELL: '🔴', HOLD: '🟡' };

const S: Record<string, React.CSSProperties> = {
  card: { background: '#1e1e3a', border: '1px solid #3a3a5a', borderRadius: 12, padding: 20 },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  badge: {
    padding: '6px 16px', borderRadius: 20, fontWeight: 700, fontSize: 16,
  },
  confidence: { fontSize: 13, color: '#909090' },
  reasoning: { color: '#c0c0d0', fontSize: 14, lineHeight: 1.6, marginBottom: 16 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, color: '#808090', marginBottom: 6, fontWeight: 600 },
  signal: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 13, color: '#c0d0c0' },
  risk: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 13, color: '#d0c0c0' },
  target: { fontSize: 13, color: '#7c3aed', fontWeight: 600, marginTop: 8 },
  timestamp: { fontSize: 11, color: '#505060', marginTop: 12 },
};

export default function AIRecommendation({ data }: { data: AIRec }) {
  const color = colors[data.recommendation] || '#9090a0';
  const emoji = emojis[data.recommendation] || '⚪';

  return (
    <div style={S.card}>
      <div style={S.header}>
        <span style={{ ...S.badge, background: `${color}20`, color, border: `1px solid ${color}` }}>
          {emoji} {data.recommendation}
        </span>
        <span style={S.confidence}>Confidence: {data.confidence}%</span>
      </div>

      <p style={S.reasoning}>{data.reasoning}</p>

      {data.key_signals.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>✅ KEY SIGNALS</div>
          {data.key_signals.map((s, i) => (
            <div key={i} style={S.signal}>• {s}</div>
          ))}
        </div>
      )}

      {data.risks.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>⚠️ RISKS</div>
          {data.risks.map((r, i) => (
            <div key={i} style={S.risk}>• {r}</div>
          ))}
        </div>
      )}

      {data.target_price && (
        <div style={S.target}>🎯 Target Price: {formatCurrency(data.target_price)}</div>
      )}

      {data.analysis_timestamp && (
        <div style={S.timestamp}>Analysis: {formatDate(data.analysis_timestamp)}</div>
      )}
    </div>
  );
}
