import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

function timeAgo(value) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState(null);
  const containerRef = useRef(null);

  async function loadUnreadCount() {
    try {
      const { data } = await apiClient.get('/notifications/unread-count');
      setUnreadCount(data.count || 0);
    } catch {
      // sessizce yoksay - bildirim sayacı kritik değil
    }
  }

  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        const { data } = await apiClient.get('/notifications');
        setItems(data.notifications);
      } catch {
        setItems([]);
      }
    }
  }

  async function handleClickNotification(n) {
    if (!n.isRead) {
      apiClient.post(`/notifications/${n.id}/read`).catch(() => {});
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, isRead: true } : it)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.nonconformityId) navigate(`/uygunsuzluklar/${n.nonconformityId}`);
  }

  async function handleMarkAllRead() {
    try {
      await apiClient.post('/notifications/read-all');
      setItems((prev) => prev?.map((it) => ({ ...it, isRead: true })));
      setUnreadCount(0);
    } catch {
      // yoksay
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggleOpen}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        aria-label="Bildirimler"
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[90vw] rounded-2xl border border-slate-200 bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-semibold text-slate-800">Bildirimler</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs font-medium text-brand-700 hover:underline">
                Tümünü okundu işaretle
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items === null && <p className="px-4 py-6 text-center text-sm text-slate-400">Yükleniyor...</p>}
            {items?.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Henüz bildirim yok.</p>}
            {items?.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClickNotification(n)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                  !n.isRead ? 'bg-brand-50/50' : ''
                }`}
              >
                <div className="flex w-full items-center gap-2">
                  {!n.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                  <span className="text-sm font-medium text-slate-800">{n.title}</span>
                </div>
                <span className="text-xs text-slate-500">{n.message}</span>
                <span className="text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
