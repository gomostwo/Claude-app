import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../store/store';
import { logout } from '../../store/authSlice';
import NotificationBell from '../notifications/NotificationBell';

const S: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', minHeight: '100vh', background: '#0f0f1a' },
  sidebar: {
    width: 220, background: '#1a1a2e', padding: '24px 0', display: 'flex',
    flexDirection: 'column', borderRight: '1px solid #2a2a4a', flexShrink: 0,
  },
  brand: { padding: '0 20px 24px', fontSize: 20, fontWeight: 700, color: '#7c3aed' },
  nav: { flex: 1 },
  navItem: {
    display: 'block', padding: '12px 20px', color: '#b0b0c0', textDecoration: 'none',
    fontSize: 14, transition: 'all 0.2s',
  },
  navItemActive: { color: '#7c3aed', background: 'rgba(124,58,237,0.1)', borderLeft: '3px solid #7c3aed' },
  footer: { padding: '16px 20px', borderTop: '1px solid #2a2a4a' },
  userInfo: { fontSize: 12, color: '#808090', marginBottom: 8 },
  logoutBtn: {
    background: 'none', border: '1px solid #3a3a5a', color: '#b0b0c0',
    padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, width: '100%',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column' },
  topbar: {
    background: '#1a1a2e', borderBottom: '1px solid #2a2a4a',
    padding: '12px 24px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: { flex: 1, padding: '24px', overflowY: 'auto' },
};

const navLinks = [
  { to: '/', label: '📊 Dashboard' },
  { to: '/watchlist', label: '👁 Watchlist' },
  { to: '/screener', label: '🔍 Screener' },
  { to: '/profile', label: '👤 Profile' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const user = useSelector((s: RootState) => s.auth.user);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  return (
    <div style={S.shell}>
      <aside style={S.sidebar}>
        <div style={S.brand}>📈 StockAI</div>
        <nav style={S.nav}>
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              style={{
                ...S.navItem,
                ...(location.pathname === link.to ? S.navItemActive : {}),
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div style={S.footer}>
          <div style={S.userInfo}>{user?.username}</div>
          <button style={S.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </aside>
      <main style={S.main}>
        <div style={S.topbar}>
          <span style={{ color: '#7c3aed', fontWeight: 600, fontSize: 14 }}>
            {navLinks.find((l) => l.to === location.pathname)?.label?.replace(/^[^\s]+\s/, '') || 'StockAI'}
          </span>
          <NotificationBell />
        </div>
        <div style={S.content}>{children}</div>
      </main>
    </div>
  );
}
