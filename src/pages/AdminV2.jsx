import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';

const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET;

const DATA_TABS = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'user_profiles', label: 'User Profile' },
  { id: 'follow_up_queue', label: 'Follow-Up Queue' },
  { id: 'growth_markers', label: 'Growth Markers' },
  { id: 'reflection_patterns', label: 'Reflection Patterns' },
  { id: 'goals', label: 'Goals' },
];

// ─── JsonViewer ───────────────────────────────────────────────────────────────

function JsonValue({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-zinc-500 italic">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-400' : 'text-red-400'}>{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className="text-blue-400">{value}</span>;
  }
  if (typeof value === 'string') {
    return <span className="text-amber-300">"{value}"</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>;
    return (
      <span>
        [
        {value.map((item, i) => (
          <span key={i}>
            <JsonValue value={item} />
            {i < value.length - 1 && <span className="text-zinc-500">, </span>}
          </span>
        ))}
        ]
      </span>
    );
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return <span className="text-zinc-500">{'{}'}</span>;
    return (
      <span>
        {'{'}
        <div className="pl-4">
          {keys.map((k, i) => (
            <div key={k}>
              <span className="text-zinc-400">{k}: </span>
              <JsonValue value={value[k]} />
              {i < keys.length - 1 && <span className="text-zinc-500">,</span>}
            </div>
          ))}
        </div>
        {'}'}
      </span>
    );
  }
  return <span className="text-zinc-300">{String(value)}</span>;
}

function JsonViewer({ data }) {
  return (
    <div className="text-xs font-mono leading-relaxed">
      <JsonValue value={data} />
    </div>
  );
}

// ─── ExpandableRow ────────────────────────────────────────────────────────────

function ExpandableRow({ row, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const keys = Object.keys(row);
  const preview = row.id?.slice(0, 8) || '—';

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden mb-2">
      <div
        className="flex items-center justify-between px-4 py-3 bg-zinc-900 cursor-pointer hover:bg-zinc-800 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-mono text-xs text-zinc-500">#{preview}</span>
          {row.created_at && (
            <span className="text-zinc-500 text-xs">{new Date(row.created_at).toLocaleDateString()}</span>
          )}
          {row.date && <span className="text-zinc-400 text-xs font-medium">{row.date}</span>}
          {row.role && <span className="text-zinc-400 text-xs">{row.role}</span>}
          {row.content && (
            <span className="text-zinc-400 text-xs truncate max-w-[200px]">
              {String(row.content).slice(0, 80)}
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}
          className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="px-4 py-3 bg-zinc-950 border-t border-zinc-800">
          <table className="w-full text-xs">
            <tbody>
              {keys.map((key) => (
                <tr key={key} className="border-b border-zinc-800 last:border-0">
                  <td className="py-1.5 pr-4 text-zinc-500 font-medium align-top w-1/4">{key}</td>
                  <td className="py-1.5 text-zinc-300 break-all">
                    <JsonViewer data={row[key]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

function SessionCard({ session, userId, onDelete, isToday }) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  async function loadMessages() {
    if (messages.length > 0) return;
    setLoadingMsgs(true);
    try {
      const res = await fetch('/api/admin-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          admin_secret: ADMIN_SECRET,
          table: 'reflection_messages',
          session_id: session.id,
        }),
      });
      const json = await res.json();
      setMessages(json.data || []);
    } catch (_e) {}
    setLoadingMsgs(false);
  }

  async function deleteMessage(msgId) {
    try {
      await fetch('/api/admin-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          admin_secret: ADMIN_SECRET,
          table: 'reflection_messages',
          delete_id: msgId,
        }),
      });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (_e) {}
  }

  async function deleteAllMessages() {
    if (!confirm('Delete ALL messages for this session?')) return;
    try {
      await fetch('/api/admin-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          admin_secret: ADMIN_SECRET,
          table: 'reflection_messages',
          delete_session_messages: true,
          session_id: session.id,
        }),
      });
      setMessages([]);
    } catch (_e) {}
  }

  function handleToggle() {
    setExpanded((v) => {
      if (!v) loadMessages();
      return !v;
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden mb-3">
      <div
        className="flex items-center justify-between px-4 py-3 bg-zinc-900 cursor-pointer hover:bg-zinc-800 transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3 text-sm">
          {expanded ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
          <span className="text-white font-medium">{session.date}</span>
          {isToday && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-white">TODAY</span>
          )}
          <span className="text-zinc-500 text-xs">{session.current_stage}</span>
          {session.is_complete && (
            <span className="px-2 py-0.5 rounded text-xs bg-green-900/40 text-green-400 border border-green-800">complete</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {session.tomorrow_commitment && (
            <span className="text-zinc-500 text-xs max-w-[150px] truncate hidden sm:block">
              {session.tomorrow_commitment}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
            className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="bg-zinc-950 border-t border-zinc-800 px-4 py-4 space-y-4">
          {/* Session metadata */}
          <div>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">Session Metadata</p>
            <table className="w-full text-xs">
              <tbody>
                {['mood_end_of_day', 'checklist', 'exercises_run', 'consecutive_excuses', 'reflection_streak'].map((key) => (
                  <tr key={key} className="border-b border-zinc-900 last:border-0">
                    <td className="py-1.5 pr-4 text-zinc-500 align-top w-1/3">{key}</td>
                    <td className="py-1.5 text-zinc-300"><JsonViewer data={session[key]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Messages */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">
                Messages ({messages.length})
              </p>
              {messages.length > 0 && (
                <button
                  onClick={deleteAllMessages}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Delete all messages
                </button>
              )}
            </div>

            {loadingMsgs ? (
              <p className="text-zinc-600 text-xs">Loading...</p>
            ) : messages.length === 0 ? (
              <p className="text-zinc-600 text-xs">No messages</p>
            ) : (
              <div className="space-y-1.5">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex items-start justify-between gap-2 border border-zinc-800 rounded-lg px-3 py-2 bg-zinc-900">
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-medium mr-2 ${msg.role === 'user' ? 'text-red-400' : 'text-blue-400'}`}>
                        {msg.role}
                      </span>
                      <span className="text-zinc-400 text-xs">
                        {String(msg.content || '').slice(0, 120)}
                        {String(msg.content || '').length > 120 && '…'}
                      </span>
                    </div>
                    <button
                      onClick={() => deleteMessage(msg.id)}
                      className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main AdminV2 ─────────────────────────────────────────────────────────────

export default function AdminV2() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isAdmin, setIsAdmin] = useState(null); // null = loading
  const [activeTab, setActiveTab] = useState('sessions');
  const [sessions, setSessions] = useState([]);
  const [tabData, setTabData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');

  // todayStr uses local time getters (not UTC) so the date matches the user's timezone.
  const todayStr = localDateStr();

  // ── Admin check ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.role === 'admin') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          navigate('/reflection', { replace: true });
        }
      })
      .catch(() => {
        setIsAdmin(false);
        navigate('/reflection', { replace: true });
      });
  }, [user?.id]);

  // ── Load sessions on mount ────────────────────────────────────────────────

  useEffect(() => {
    if (isAdmin) loadSessions();
  }, [isAdmin]);

  // ── Load tab data when tab changes ────────────────────────────────────────

  useEffect(() => {
    if (!isAdmin || activeTab === 'sessions') return;
    loadTabData(activeTab);
  }, [activeTab, isAdmin]);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          admin_secret: ADMIN_SECRET,
          table: 'reflection_sessions',
        }),
      });
      const json = await res.json();
      setSessions(json.data || []);
    } catch (_e) {}
    setLoading(false);
  }

  async function loadTabData(tab) {
    setLoading(true);
    setTabData([]);
    try {
      const res = await fetch('/api/admin-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          admin_secret: ADMIN_SECRET,
          table: tab,
        }),
      });
      const json = await res.json();
      setTabData(json.data || []);
    } catch (_e) {}
    setLoading(false);
  }

  async function deleteTabRow(id) {
    if (!confirm('Delete this row?')) return;
    try {
      await fetch('/api/admin-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          admin_secret: ADMIN_SECRET,
          table: activeTab,
          delete_id: id,
        }),
      });
      setTabData((prev) => prev.filter((r) => r.id !== id));
    } catch (_e) {}
  }

  async function deleteSession(id) {
    if (!confirm('Delete this session and its messages?')) return;
    try {
      await fetch('/api/admin-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          admin_secret: ADMIN_SECRET,
          table: 'reflection_sessions',
          delete_id: id,
        }),
      });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (_e) {}
  }

  // ── Reset today ───────────────────────────────────────────────────────────

  async function handleResetToday() {
    if (!confirm("Reset today's reflection session? This deletes it and all its messages.")) return;
    setResultMsg('');
    try {
      const res = await fetch('/api/admin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, admin_secret: ADMIN_SECRET, target_date: localDateStr() }),
      });
      const json = await res.json();
      if (json.ok) {
        setResultMsg(`✅ Deleted session ${json.deleted_session_id || '(none found)'} for ${json.date}`);
        setSessions((prev) => prev.filter((s) => s.date !== todayStr));
      } else {
        setResultMsg('❌ Reset failed');
      }
    } catch (_e) {
      setResultMsg('❌ Reset failed');
    }
  }

  // ── Nuke all data ─────────────────────────────────────────────────────────

  async function handleNukeAll() {
    if (!confirm('⚠️ This will delete ALL reflection data for this user. Are you sure?')) return;
    if (!confirm('⚠️ SECOND CONFIRM: Nuke all sessions, messages, follow-up queue, growth markers, and patterns? This cannot be undone.')) return;
    setResultMsg('');
    try {
      const res = await fetch('/api/admin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, admin_secret: ADMIN_SECRET, delete_all: true }),
      });
      const json = await res.json();
      if (json.ok) {
        setResultMsg('✅ All data deleted');
        setSessions([]);
        setTabData([]);
      } else {
        setResultMsg('❌ Nuke failed');
      }
    } catch (_e) {
      setResultMsg('❌ Nuke failed');
    }
  }

  // ── Loading / not admin ───────────────────────────────────────────────────

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShellV2 title="Admin Panel">
      <div className="h-full overflow-y-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-red-500" />
          <h2 className="text-white font-semibold text-lg">Admin Panel</h2>
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-900/40 border border-red-800 text-red-400">DEV</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleResetToday}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reset Today
          </button>
          <button
            onClick={handleNukeAll}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-900/30 border border-red-800 text-red-400 hover:bg-red-900/60 hover:text-red-300 text-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Nuke All Data
          </button>
          <button
            onClick={() => activeTab === 'sessions' ? loadSessions() : loadTabData(activeTab)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {resultMsg && (
          <div className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-zinc-300">
            {resultMsg}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap border-b border-zinc-800 pb-1">
          {DATA_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-red-700 text-white'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {loading ? (
            <div className="flex items-center gap-3 py-8 justify-center">
              <div className="w-6 h-6 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
              <span className="text-zinc-500 text-sm">Loading...</span>
            </div>
          ) : activeTab === 'sessions' ? (
            sessions.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">No sessions found</p>
            ) : (
              sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  userId={user.id}
                  onDelete={deleteSession}
                  isToday={session.date === todayStr}
                />
              ))
            )
          ) : tabData.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-8">No data found</p>
          ) : (
            tabData.map((row) => (
              <ExpandableRow key={row.id} row={row} onDelete={deleteTabRow} />
            ))
          )}
        </div>
      </div>
    </AppShellV2>
  );
}
