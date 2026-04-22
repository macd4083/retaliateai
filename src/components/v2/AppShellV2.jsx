import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings, Moon, BarChart2, X, Database, Video, Download, Share } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase/client';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import PWAInstallBanner from '../pwa/PWAInstallBanner';

const NAV_LINKS = [
  { label: 'Reflection', path: '/reflection', icon: Moon },
  { label: 'Insights', path: '/insights', icon: BarChart2 },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export default function AppShellV2({ title, children, adminAction = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTimeOverride, setAdminTimeOverride] = useState(null);
  const [showIosTooltip, setShowIosTooltip] = useState(false);
  const { isInstallable, isIos, isStandalone, promptInstall } = usePWAInstall();

  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'You';

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setIsAdmin(data?.role === 'admin');
      })
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAdminTimeOverride(window.localStorage.getItem('admin_time_override'));
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleDownloadClick = async () => {
    if (isIos) {
      setShowIosTooltip((v) => !v);
      return;
    }
    await promptInstall();
  };

  useEffect(() => {
    if (!showIosTooltip) return;
    const handler = () => setShowIosTooltip(false);
    window.addEventListener('click', handler, { once: true });
    return () => window.removeEventListener('click', handler);
  }, [showIosTooltip]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────── */}
      <div className="h-14 flex-shrink-0 flex items-center justify-between px-4 border-b border-zinc-800 bg-zinc-950 z-10 relative">
        {/* Hamburger */}
        <div className="flex-1 flex items-center">
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Open menu"
          >
            <span className="text-xl leading-none">☰</span>
          </button>
        </div>

        {/* Page Title */}
        <h1 className="absolute left-1/2 -translate-x-1/2 text-white font-semibold text-sm tracking-wide pointer-events-none select-none">
          {title}
        </h1>

        {/* Right side actions */}
        <div className="flex-1 flex items-center justify-end gap-1">
          {adminAction && adminAction}
          {isInstallable && !isStandalone && (
            <div className="relative">
              <button
                onClick={handleDownloadClick}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Install app"
              >
                <Download className="w-4 h-4" />
              </button>
              {showIosTooltip && (
                <div
                  className="absolute right-0 top-11 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-3 z-50 text-xs text-zinc-300 leading-relaxed"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="font-semibold text-white mb-1">Install Retaliate AI</p>
                  <p>
                    Tap <Share className="inline w-3 h-3" /> <strong className="text-white">"Share"</strong> in
                    your browser, then <strong className="text-white">"Add to Home Screen"</strong>.
                  </p>
                  <div className="absolute -top-1.5 right-3 w-3 h-3 bg-zinc-900 border-l border-t border-zinc-700 rotate-45" />
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => navigate('/settings')}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <PWAInstallBanner />

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">{children}</div>

      {/* ── Drawer Backdrop ──────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Slide-in Drawer ──────────────────────────────────────────── */}
      <div
        className={`fixed top-0 left-0 h-full w-72 bg-zinc-900 border-r border-zinc-800 z-30 flex flex-col transition-transform duration-300 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Drawer header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-800">
          <span className="text-white font-semibold text-sm">Menu</span>
          <button
            onClick={() => setDrawerOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-5 border-b border-zinc-800">
          <div className="w-10 h-10 rounded-full bg-red-700 flex items-center justify-center text-sm font-bold text-white mb-2">
            {displayName[0]?.toUpperCase() || 'U'}
          </div>
          <p className="text-white font-medium text-sm">{displayName}</p>
          <p className="text-zinc-500 text-xs mt-0.5 truncate">{user?.email}</p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_LINKS.map(({ label, path, icon: Icon }) => {
            const isActive = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => {
                  navigate(path);
                  setDrawerOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  isActive
                    ? 'bg-red-600 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            );
          })}
          {isAdmin && (
            <button
              onClick={() => {
                navigate('/admin');
                setDrawerOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors mt-2 ${
                location.pathname === '/admin'
                  ? 'bg-red-900 text-red-300 border border-red-700'
                  : 'text-red-500 hover:text-red-300 hover:bg-red-900/30 border border-transparent'
              }`}
            >
              <Database className="w-4 h-4 flex-shrink-0" />
              Admin
              <span className="ml-auto px-1.5 py-0.5 rounded text-xs font-bold bg-red-900/60 border border-red-800 text-red-400">DEV</span>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => { navigate('/recorder'); setDrawerOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                location.pathname === '/recorder'
                  ? 'bg-red-900 text-red-300 border border-red-700'
                  : 'text-red-400 hover:text-red-300 hover:bg-red-900/30 border border-transparent'
              }`}
            >
              <Video className="w-4 h-4 flex-shrink-0" />
              UI Recorder
            </button>
          )}
        </nav>

        {isAdmin && (
          <div className="px-3 pb-3">
            <p className="text-zinc-600 text-xs px-1 mb-1.5">Time Override</p>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  window.localStorage.setItem('admin_time_override', 'afternoon');
                  setAdminTimeOverride('afternoon');
                }}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                  adminTimeOverride === 'afternoon'
                    ? 'bg-amber-900/40 border-amber-700 text-amber-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                ☀️ Afternoon
              </button>
              <button
                onClick={() => {
                  window.localStorage.removeItem('admin_time_override');
                  setAdminTimeOverride(null);
                }}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                  !adminTimeOverride
                    ? 'bg-zinc-700 border-zinc-600 text-zinc-200'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                🌙 Real time
              </button>
            </div>
          </div>
        )}

        {/* Sign out */}
        <div className="px-3 py-4 border-t border-zinc-800">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:text-white hover:bg-red-900/40 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
