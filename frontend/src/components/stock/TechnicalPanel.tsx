import React from 'react';
import { TechnicalData } from '../../types';

const S: Record<string, React.CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  card: { background: '#1e1e3a', border: '1px solid #3a3a5a', borderRadius: 8, padding: 14 },
  label: { fontSize: 11, color: '#707080', marginBottom: 4, textTransform: 'uppercase' },
  value: { fontSize: 18, fontWeight: 700, color: '#e0e0f0' },
  sub: { fontSize: 12, color: '#909090', marginTop: 4 },
  trendBull: { color: '#22c55e' },
  trendBear: { color: '#ef4444' },
  trendNeut: { color: '#f59e0b' },
};

function RsiGauge({ rsi }: { rsi: number }) {
  const color = rsi > 70 ? '#ef4444' : rsi < 30 ? '#22c55e' : '#7c3aed';
  const label = rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral';
  return (
    <div style={S.card}>
      <div style={S.label}>RSI (14)</div>
      <div style={{ ...S.value, color }}>{rsi.toFixed(1)}</div>
      <div style={{ ...S.sub, color }}>{label}</div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={S.card}>
      <div style={S.label}>{label}</div>
      <div style={S.value}>{value}</div>
      {sub && <div style={S.sub}>{sub}</div>}
    </div>
  );
}

export default function TechnicalPanel({ data }: { data: TechnicalData }) {
  const trendStyle =
    data.trend === 'bullish' ? S.trendBull :
    data.trend === 'bearish' ? S.trendBear : S.trendNeut;

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: '#909090' }}>Trend:</span>
        <span style={{ ...trendStyle, fontWeight: 700, textTransform: 'capitalize' }}>
          {data.trend === 'bullish' ? '📈' : data.trend === 'bearish' ? '📉' : '➡️'} {data.trend || 'N/A'}
        </span>
      </div>
      <div style={S.grid}>
        {data.rsi != null && <RsiGauge rsi={data.rsi} />}
        {data.macd != null && (
          <MetricCard
            label="MACD"
            value={data.macd.toFixed(4)}
            sub={`Signal: ${data.macd_signal?.toFixed(4) ?? 'N/A'} | Hist: ${data.macd_hist?.toFixed(4) ?? 'N/A'}`}
          />
        )}
        {data.sma_20 != null && <MetricCard label="SMA 20" value={`$${data.sma_20.toFixed(2)}`} />}
        {data.sma_50 != null && <MetricCard label="SMA 50" value={`$${data.sma_50.toFixed(2)}`} />}
        {data.sma_200 != null && <MetricCard label="SMA 200" value={`$${data.sma_200.toFixed(2)}`} />}
        {data.ema_20 != null && <MetricCard label="EMA 20" value={`$${data.ema_20.toFixed(2)}`} />}
        {data.bb_upper != null && (
          <MetricCard
            label="Bollinger Bands"
            value={`$${data.bb_middle?.toFixed(2) ?? 'N/A'}`}
            sub={`Upper: $${data.bb_upper.toFixed(2)} | Lower: $${data.bb_lower?.toFixed(2) ?? 'N/A'}`}
          />
        )}
        {data.volume_ratio != null && (
          <MetricCard
            label="Volume Ratio"
            value={`${data.volume_ratio.toFixed(2)}x`}
            sub={data.volume_ratio > 2 ? '⚠️ Unusual volume' : 'vs 20-day avg'}
          />
        )}
      </div>
    </div>
  );
}
