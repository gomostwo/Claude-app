import React, { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../store/store';
import { setNotifications, markAsRead, markAllAsRead } from '../../store/notificationSlice';
import { getNotifications, markRead, markAllRead } from '../../api/notifications';
import { formatDate } from '../../utils/formatters';

const S: Record<string, React.CSSProperties> = {
  wrapper: { position: 'relative' },
  btn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#b0b0c0',
    fontSize: 20, position: 'relative', padding: '4px 8px',
  },
  badge: {
    position: 'absolute', top: 0, right: 0, background: '#ef4444',
    color: '#fff', borderRadius: '50%', width: 16, height: 16,
    fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700,
  },
  panel: {
    position: 'absolute', right: 0, top: '100%', width: 360,
    background: '#1e1e3a', border: '1px solid #3a3a5a', borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 1000, maxHeight: 480,
    overflow: 'hidden', display: 'flex', flexDirection: 'column',
  },
  panelHeader: {
    padding: '12px 16px', borderBottom: '1px solid #3a3a5a',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  panelTitle: { fontWeight: 600, color: '#e0e0e0', fontSize: 14 },
  markAllBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 12,
  },
  list: { overflowY: 'auto', flex: 1 },
  item: {
    padding: '12px 16px', borderBottom: '1px solid #2a2a4a', cursor: 'pointer',
    transition: 'background 0.15s',
  },
  itemUnread: { background: 'rgba(124,58,237,0.08)' },
  itemTitle: { fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 },
  itemMsg: { fontSize: 12, color: '#909090', marginBottom: 4, lineHeight: 1.4 },
  itemDate: { fontSize: 11, color: '#606070' },
  empty: { padding: 24, textAlign: 'center', color: '#606070', fontSize: 13 },
};

const typeEmoji: Record<string, string> = {
  price_above: '📈', price_below: '📉', rsi_alert: '📊',
  ai_recommendation: '🤖', system: 'ℹ️',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const dispatch = useDispatch();
  const { items, unreadCount } = useSelector((s: RootState) => s.notifications);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadNotifications = async () => {
    try {
      const res = await getNotifications();
      dispatch(setNotifications(res.data));
    } catch {}
  };

  const handleMarkAll = async () => {
    await markAllRead();
    dispatch(markAllAsRead());
  };

  const handleItemClick = async (id: number) => {
    await markRead(id);
    dispatch(markAsRead(id));
  };

  return (
    <div style={S.wrapper} ref={ref}>
      <button style={S.btn} onClick={() => setOpen(!open)}>
        🔔
        {unreadCount > 0 && <span style={S.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div style={S.panel}>
          <div style={S.panelHeader}>
            <span style={S.panelTitle}>Notifications ({unreadCount} unread)</span>
            {unreadCount > 0 && (
              <button style={S.markAllBtn} onClick={handleMarkAll}>Mark all read</button>
            )}
          </div>
          <div style={S.list}>
            {items.length === 0 ? (
              <div style={S.empty}>No notifications yet</div>
            ) : (
              items.slice(0, 30).map((n) => (
                <div
                  key={n.id}
                  style={{ ...S.item, ...(n.is_read ? {} : S.itemUnread) }}
                  onClick={() => handleItemClick(n.id)}
                >
                  <div style={S.itemTitle}>
                    {typeEmoji[n.type] || '🔔'} {n.title}
                  </div>
                  <div style={S.itemMsg}>{n.message}</div>
                  <div style={S.itemDate}>{formatDate(n.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
