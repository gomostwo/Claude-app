import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getQuote, getTechnical, getFundamental, analyzeStock } from '../api/stocks';
import { addToWatchlist, getWatchlist } from '../api/watchlist';
import { StockQuote, TechnicalData, FundamentalData, AIRecommendation as AIRec } from '../types';
import { formatCurrency, formatLargeNumber } from '../utils/formatters';
import TechnicalPanel from '../components/stock/TechnicalPanel';
import FundamentalPanel from '../components/stock/FundamentalPanel';
import AIRecommendation from '../components/stock/AIRecommendation';

const S: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  ticker: { fontSize: 32, fontWeight: 800, color: '#7c3aed' },
  name: { fontSize: 16, color: '#909090', marginTop: 4 },
  priceBox: { textAlign: 'right' },
  price: { fontSize: 28, fontWeight: 700, color: '#e0e0e0' },
  change: { fontSize: 15, marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, background: '#1a1a2e', borderRadius: 8, padding: 4 },
  tab: {
    padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 14, background: 'none', color: '#909090',
  },
  tabActive: { background: '#7c3aed', color: '#fff' },
  btn: {
    padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 14, fontWeight: 600,
  },
  analyzeBtn: { background: '#7c3aed', color: '#fff' },
  watchBtn: { background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid #7c3aed' },
  btnRow: { display: 'flex', gap: 10, marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: '#c0c0d0', marginBottom: 12 },
  loading: { color: '#7c3aed', textAlign: 'center', padding: 40 },
  metaRow: { display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' as const },
  metaBadge: {
    padding: '4px 12px', background: '#1e1e3a', border: '1px solid #3a3a5a',
    borderRadius: 20, fontSize: 12, color: '#b0b0c0',
  },
};

type Tab = 'technical' | 'fundamental' | 'ai';

export default function StockDetail() {
  const { ticker } = useParams<{ ticker: string }>();
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [technical, setTechnical] = useState<TechnicalData | null>(null);
  const [fundamental, setFundamental] = useState<FundamentalData | null>(null);
  const [aiRec, setAiRec] = useState<AIRec | null>(null);
  const [tab, setTab] = useState<Tab>('technical');
  const [analyzing, setAnalyzing] = useState(false);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ticker) return;
    loadData(ticker.toUpperCase());
  }, [ticker]);

  const loadData = async (t: string) => {
    try {
      const [q, tech, fund, wl] = await Promise.allSettled([
        getQuote(t),
        getTechnical(t),
        getFundamental(t),
        getWatchlist(),
      ]);
      if (q.status === 'fulfilled') setQuote(q.value.data);
      if (tech.status === 'fulfilled') setTechnical(tech.value.data);
      if (fund.status === 'fulfilled') setFundamental(fund.value.data);
      if (wl.status === 'fulfilled') setInWatchlist(wl.value.data.some((i) => i.ticker === t));
    } catch {}
  };

  const handleAnalyze = async () => {
    if (!ticker) return;
    setAnalyzing(true);
    setError('');
    try {
      const res = await analyzeStock(ticker.toUpperCase());
      setAiRec(res.data.ai_recommendation || null);
      setTab('ai');
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Analysis failed');
    }
    setAnalyzing(false);
  };

  const handleAddWatchlist = async () => {
    if (!ticker) return;
    setAdding(true);
    try {
      await addToWatchlist({ ticker: ticker.toUpperCase() });
      setInWatchlist(true);
    } catch {}
    setAdding(false);
  };

  if (!quote) return <div style={S.loading}>Loading {ticker}...</div>;

  const changePositive = (quote.change || 0) >= 0;

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={S.header}>
        <div>
          <div style={S.ticker}>{quote.ticker}</div>
          <div style={S.name}>{quote.company_name}</div>
          <div style={S.metaRow}>
            <span style={S.metaBadge}>{quote.asset_type}</span>
            {quote.market_cap && <span style={S.metaBadge}>Market Cap: {formatLargeNumber(quote.market_cap)}</span>}
            {quote.currency && <span style={S.metaBadge}>{quote.currency}</span>}
          </div>
        </div>
        <div style={S.priceBox}>
          <div style={S.price}>{formatCurrency(quote.price)}</div>
          <div style={{ ...S.change, color: changePositive ? '#22c55e' : '#ef4444' }}>
            {changePositive ? '+' : ''}{quote.change?.toFixed(2)} ({quote.change_percent?.toFixed(2)}%)
          </div>
        </div>
      </div>

      <div style={S.btnRow}>
        <button
          style={{ ...S.btn, ...S.analyzeBtn }}
          onClick={handleAnalyze}
          disabled={analyzing}
        >
          {analyzing ? '⏳ Analyzing...' : '🤖 AI Analyze'}
        </button>
        {!inWatchlist && (
          <button
            style={{ ...S.btn, ...S.watchBtn }}
            onClick={handleAddWatchlist}
            disabled={adding}
          >
            {adding ? 'Adding...' : '+ Add to Watchlist'}
          </button>
        )}
        {inWatchlist && (
          <span style={{ ...S.btn, ...S.watchBtn, cursor: 'default' }}>✓ In Watchlist</span>
        )}
      </div>

      {error && <p style={{ color: '#ef4444', marginBottom: 16, fontSize: 14 }}>{error}</p>}

      <div style={S.tabs}>
        {(['technical', 'fundamental', 'ai'] as Tab[]).map((t) => (
          <button
            key={t}
            style={{ ...S.tab, ...(tab === t ? S.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t === 'technical' ? '📊 Technical' : t === 'fundamental' ? '📋 Fundamental' : '🤖 AI Recommendation'}
          </button>
        ))}
      </div>

      {tab === 'technical' && (
        technical ? <TechnicalPanel data={technical} /> : <p style={{ color: '#606070' }}>No technical data available.</p>
      )}
      {tab === 'fundamental' && (
        fundamental ? <FundamentalPanel data={fundamental} /> :
        <p style={{ color: '#606070' }}>Fundamental data not available for this asset (commodities show technical only).</p>
      )}
      {tab === 'ai' && (
        aiRec ? <AIRecommendation data={aiRec} /> :
        <div style={{ textAlign: 'center', padding: 40, color: '#606070' }}>
          <p>No AI analysis yet.</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>Click "🤖 AI Analyze" to generate a personalized recommendation.</p>
        </div>
      )}
    </div>
  );
}
