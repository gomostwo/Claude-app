import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../store/store';
import { getWatchlist, removeFromWatchlist } from '../api/watchlist';
import { getQuote } from '../api/stocks';
import { WatchlistItem, StockQuote } from '../types';
import { formatCurrency, formatChange } from '../utils/formatters';
import StockSearchBar from '../components/stock/StockSearchBar';

const S: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#e0e0e0' },
  card: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 12, padding: 20, marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#606070', borderBottom: '1px solid #2a2a4a' },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #1e1e2e' },
  ticker: { fontWeight: 700, color: '#7c3aed', textDecoration: 'none' },
  positive: { color: '#22c55e' },
  negative: { color: '#ef4444' },
  analyzeBtn: {
    padding: '4px 12px', background: 'rgba(124,58,237,0.2)', color: '#a78bfa',
    border: '1px solid #7c3aed', borderRadius: 6, cursor: 'pointer', fontSize: 12, textDecoration: 'none',
  },
  removeBtn: {
    padding: '4px 12px', background: 'none', color: '#ef4444',
    border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 12,
  },
  commoditySection: { marginBottom: 28 },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: '#909090', marginBottom: 12 },
  empty: { textAlign: 'center', color: '#606070', padding: 40, fontSize: 14 },
  profileBanner: {
    background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)',
    borderRadius: 10, padding: '12px 20px', marginBottom: 20, fontSize: 13, color: '#a78bfa',
  },
};

const COMMODITY_TICKERS = ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F'];

export default function Dashboard() {
  const user = useSelector((s: RootState) => s.auth.user);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadWatchlist(); }, []);

  const loadWatchlist = async () => {
    setLoading(true);
    try {
      const res = await getWatchlist();
      setWatchlist(res.data);
      // Fetch quotes in parallel
      const quoteMap: Record<string, StockQuote> = {};
      await Promise.allSettled(
        res.data.map(async (item) => {
          try {
            const q = await getQuote(item.ticker);
            quoteMap[item.ticker] = q.data;
          } catch {}
        })
      );
      setQuotes(quoteMap);
    } catch {}
    setLoading(false);
  };

  const handleRemove = async (id: number, ticker: string) => {
    await removeFromWatchlist(id);
    setWatchlist((prev) => prev.filter((i) => i.id !== id));
    setQuotes((prev) => { const q = { ...prev }; delete q[ticker]; return q; });
  };

  const stocks = watchlist.filter((i) => i.asset_type === 'stock');
  const commodities = watchlist.filter((i) => i.asset_type === 'commodity');

  const profileComplete = user?.budget && user?.investment_style && user?.time_horizon;

  return (
    <div>
      <div style={S.header}>
        <div style={S.title}>Dashboard</div>
        <StockSearchBar />
      </div>

      {!profileComplete && (
        <div style={S.profileBanner}>
          ⚠️ Complete your <Link to="/profile" style={{ color: '#c4b5fd' }}>investment profile</Link> to get personalized AI recommendations.
        </div>
      )}

      {loading ? (
        <div style={S.empty}>Loading watchlist...</div>
      ) : watchlist.length === 0 ? (
        <div style={S.card}>
          <div style={S.empty}>
            Your watchlist is empty. Search for a stock or commodity above and click Analyze to add it.
          </div>
        </div>
      ) : (
        <>
          {commodities.length > 0 && (
            <div style={S.commoditySection}>
              <div style={S.sectionTitle}>🪙 Commodities</div>
              <WatchlistTable items={commodities} quotes={quotes} onRemove={handleRemove} />
            </div>
          )}
          {stocks.length > 0 && (
            <div>
              <div style={S.sectionTitle}>📊 Stocks</div>
              <WatchlistTable items={stocks} quotes={quotes} onRemove={handleRemove} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WatchlistTable({ items, quotes, onRemove }: {
  items: WatchlistItem[];
  quotes: Record<string, StockQuote>;
  onRemove: (id: number, ticker: string) => void;
}) {
  return (
    <div style={{ background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Ticker', 'Name', 'Price', 'Change', 'Actions'].map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: '#606070', borderBottom: '1px solid #2a2a4a' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const q = quotes[item.ticker];
            const changePositive = (q?.change || 0) >= 0;
            return (
              <tr key={item.id}>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #1e1e2e' }}>
                  <Link to={`/stock/${item.ticker}`} style={{ fontWeight: 700, color: '#7c3aed', textDecoration: 'none' }}>
                    {item.ticker}
                  </Link>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#909090', borderBottom: '1px solid #1e1e2e' }}>
                  {item.company_name || '—'}
                </td>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e0e0e0', borderBottom: '1px solid #1e1e2e' }}>
                  {q?.price ? formatCurrency(q.price) : '—'}
                </td>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #1e1e2e', color: changePositive ? '#22c55e' : '#ef4444' }}>
                  {q?.change ? `${changePositive ? '+' : ''}${formatChange(q.change)} (${q.change_percent?.toFixed(2)}%)` : '—'}
                </td>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #1e1e2e', display: 'flex', gap: 8 }}>
                  <Link to={`/stock/${item.ticker}`} style={{ padding: '4px 12px', background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid #7c3aed', borderRadius: 6, cursor: 'pointer', fontSize: 12, textDecoration: 'none' }}>
                    Analyze
                  </Link>
                  <button
                    style={{ padding: '4px 12px', background: 'none', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                    onClick={() => onRemove(item.id, item.ticker)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
