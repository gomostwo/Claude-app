import React from 'react';
import { FundamentalData } from '../../types';
import { formatPercent } from '../../utils/formatters';

const S: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse' },
  row: { borderBottom: '1px solid #2a2a4a' },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#707080', width: '50%' },
  td: { padding: '8px 12px', fontSize: 14, color: '#e0e0f0', fontWeight: 500 },
  card: { background: '#1e1e3a', border: '1px solid #3a3a5a', borderRadius: 8, overflow: 'hidden' },
  sectorBadge: {
    display: 'inline-block', padding: '2px 10px', background: 'rgba(124,58,237,0.2)',
    color: '#a78bfa', borderRadius: 12, fontSize: 12, marginRight: 8,
  },
};

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value || value === 'N/A' || value === 'undefined') return null;
  return (
    <tr style={S.row}>
      <th style={S.th}>{label}</th>
      <td style={S.td}>{value}</td>
    </tr>
  );
}

export default function FundamentalPanel({ data }: { data: FundamentalData }) {
  const fmt = (val?: number | null, suffix = '') =>
    val != null ? `${val.toFixed(2)}${suffix}` : null;

  return (
    <div style={S.card}>
      <table style={S.table}>
        <tbody>
          <Row label="P/E Ratio" value={fmt(data.pe_ratio)} />
          <Row label="Forward P/E" value={fmt(data.forward_pe)} />
          <Row label="EPS" value={data.eps != null ? `$${data.eps.toFixed(2)}` : null} />
          <Row label="Revenue Growth" value={data.revenue_growth != null ? formatPercent(data.revenue_growth) : null} />
          <Row label="Profit Margin" value={data.profit_margin != null ? formatPercent(data.profit_margin) : null} />
          <Row label="Debt / Equity" value={fmt(data.debt_to_equity)} />
          <Row label="Dividend Yield" value={data.dividend_yield != null ? formatPercent(data.dividend_yield) : null} />
          <Row label="Beta" value={fmt(data.beta)} />
          <Row label="52W High" value={data.fifty_two_week_high != null ? `$${data.fifty_two_week_high.toFixed(2)}` : null} />
          <Row label="52W Low" value={data.fifty_two_week_low != null ? `$${data.fifty_two_week_low.toFixed(2)}` : null} />
          {(data.sector || data.industry) && (
            <tr style={S.row}>
              <th style={S.th}>Sector / Industry</th>
              <td style={S.td}>
                {data.sector && <span style={S.sectorBadge}>{data.sector}</span>}
                {data.industry && <span style={{ ...S.sectorBadge, background: 'rgba(59,130,246,0.2)', color: '#93c5fd' }}>{data.industry}</span>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
