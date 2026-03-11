import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings, Moon, BarChart2, X } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';

const NAV_LINKS = [
  { label: 'Reflection', path: '/reflection', icon: Moon },
  { label: 'Insights', path: '/insights', icon: BarChart2 },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export default function AppShellV2({ title, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'You';

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────── */}
      <div className="h-14 flex-shrink-0 flex items-center justify-between px-4 border-b border-zinc-800 bg-zinc-950 z-10">
        {/* Hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Open menu"
        >
          <span className="text-xl leading-none">☰</span>
        </button>

        {/* Page Title */}
        <h1 className="text-white font-semibold text-sm tracking-wide">{title}</h1>

        {/* Settings gear */}
        <button
          onClick={() => navigate('/settings')}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

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
        </nav>

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
