import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchStocks } from '../../api/stocks';

const S: Record<string, React.CSSProperties> = {
  wrapper: { position: 'relative', width: 320 },
  input: {
    width: '100%', padding: '8px 14px', background: '#1e1e3a',
    border: '1px solid #3a3a5a', borderRadius: 8, color: '#e0e0e0',
    fontSize: 14, outline: 'none',
  },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e1e3a',
    border: '1px solid #3a3a5a', borderRadius: 8, marginTop: 4,
    zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  },
  item: {
    padding: '10px 14px', cursor: 'pointer', display: 'flex',
    alignItems: 'center', gap: 8, borderBottom: '1px solid #2a2a4a',
  },
  ticker: { fontWeight: 700, color: '#7c3aed', fontSize: 14, minWidth: 60 },
  name: { fontSize: 13, color: '#909090' },
  type: { fontSize: 11, color: '#606070', marginLeft: 'auto' },
};

export default function StockSearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length < 1) { setResults([]); setOpen(false); return; }
      try {
        const res = await searchStocks(query);
        setResults(res.data.slice(0, 8));
        setOpen(true);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (ticker: string) => {
    navigate(`/stock/${ticker}`);
    setQuery('');
    setOpen(false);
  };

  return (
    <div style={S.wrapper} ref={ref}>
      <input
        style={S.input}
        placeholder="Search stocks, gold, oil..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && results.length > 0 && (
        <div style={S.dropdown}>
          {results.map((r) => (
            <div key={r.ticker} style={S.item} onClick={() => handleSelect(r.ticker)}>
              <span style={S.ticker}>{r.ticker}</span>
              <span style={S.name}>{r.name}</span>
              <span style={S.type}>{r.asset_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
