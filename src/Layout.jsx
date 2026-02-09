import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/lib/utils';
import { BookOpen, Sparkles, Target, Users, Menu, X, PanelLeftClose, PanelLeft, UserCog } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const navItems = [
  { name: 'Journal', icon: BookOpen, page: 'Journal', color: 'text-slate-900' },
  { name: 'Insights', icon: Sparkles, page: 'Insights', color: 'text-violet-600' },
  { name: 'Goals', icon: Target, page: 'Goals', color: 'text-blue-600' },
  { name: 'People', icon: Users, page: 'People', color: 'text-purple-600' },
  { name: 'Users', icon: UserCog, page: 'Users', color: 'text-orange-600' },
];

export default function Layout({ children, currentPageName, sidebarContent }) {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const { user, logout } = useAuth();

  const visibleNavItems = navItems;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* TOP BLACK HEADER - Small Rectangle */}
      <header className="fixed top-0 left-0 right-0 h-20 bg-black z-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <img 
            src="/logo.png" 
            alt="Retaliate AI" 
            className="w-10 h-10 object-contain"
          />
          <span className="text-2xl font-blackletter text-white tracking-tight">
            Retaliate AI
          </span>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex fixed left-0 top-20 h-[calc(100vh-5rem)] bg-white border-r border-slate-200 flex-col p-6 transition-transform duration-300 ${
        sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'
      }`}>
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/693f28bfabc4ef7dae9c8fac/8358bb909_retaliate.jpg"
                alt="Reflect"
                className="w-8 h-8 rounded-lg"
              />
              Reflect
            </h1>
            <p className="text-xs text-slate-400 mt-1">AI-Powered Journaling</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        
        <nav className="space-y-1">
          {visibleNavItems.map((item) => {
            const isActive = currentPageName === item.page;
            const Icon = item.icon;
            return (
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive 
                    ? 'bg-slate-100 text-slate-900 font-medium' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? item.color : ''}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        
        <div id="sidebar-content-slot" className="flex-1 overflow-hidden flex flex-col min-h-0"></div>
        
        <div className="pt-6 border-t border-slate-100 space-y-3">
          <div className="px-4 py-3 bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-medium text-violet-900">AI Active</span>
            </div>
            <p className="text-xs text-violet-700">Learning your patterns</p>
          </div>
          
          {user && (
            <div className="px-4 py-2">
              <p className="text-xs text-slate-500 mb-2">{user.email}</p>
              <button
                onClick={() => logout()}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Sidebar Toggle Button - When Closed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="hidden md:flex fixed top-24 left-4 z-50 bg-white border border-slate-200 shadow-sm hover:shadow-md rounded-lg w-10 h-10 items-center justify-center"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      )}

      {/* Mobile Header */}
      <header className="md:hidden fixed top-20 left-0 right-0 bg-white border-b border-slate-200 z-40 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="p-1.5 bg-slate-900 rounded-lg">
              <BookOpen className="w-4 h-4 text-white" />
            </span>
            Reflect
          </h1>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        
        {mobileMenuOpen && (
          <nav className="absolute top-full left-0 right-0 bg-white border-b border-slate-200 p-4 space-y-1 shadow-lg">
            {visibleNavItems.map((item) => {
              const isActive = currentPageName === item.page;
              const Icon = item.icon;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    isActive 
                      ? 'bg-slate-100 text-slate-900 font-medium' 
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? item.color : ''}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {/* Main Content */}
      <main className={`pt-20 transition-all duration-300 ${
        sidebarOpen ? 'md:ml-64' : 'md:ml-0'
      }`}>
        {children}
      </main>
    </div>
  );
}