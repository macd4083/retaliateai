import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Trash2, ChevronDown, ChevronRight, RefreshCw, Play, Video, WandSparkles, Pencil } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';
import AdminToolsNav from '../components/admin/AdminToolsNav';

const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET;

async function adminFetch(body) {
  let accessToken = null;
  try {
    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult?.error) {
      accessToken = sessionResult?.data?.session?.access_token || null;
    }
  } catch (_e) {}
  return fetch('/api/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ ...body, admin_secret: ADMIN_SECRET }),
  });
}

const DATA_TABS = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'user_profiles', label: 'User Profile' },
  { id: 'follow_up_queue', label: 'Follow-Up Queue' },
  { id: 'growth_markers', label: 'Growth Markers' },
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
      const res = await adminFetch({
        action: 'data',
        user_id: userId,
        table: 'reflection_messages',
        session_id: session.id,
      });
      const json = await res.json();
      setMessages(json.data || []);
    } catch (_e) {}
    setLoadingMsgs(false);
  }

  async function deleteMessage(msgId) {
    try {
      await adminFetch({
        action: 'data',
        user_id: userId,
        table: 'reflection_messages',
        delete_id: msgId,
      });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (_e) {}
  }

  async function deleteAllMessages() {
    if (!confirm('Delete ALL messages for this session?')) return;
    try {
      await adminFetch({
        action: 'data',
        user_id: userId,
        table: 'reflection_messages',
        delete_session_messages: true,
        session_id: session.id,
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
  const [commitmentRows, setCommitmentRows] = useState([]);
  const [commitmentLoading, setCommitmentLoading] = useState(false);
  const [commitmentEdits, setCommitmentEdits] = useState({});
  const [commitmentSaving, setCommitmentSaving] = useState({});
  const [commitmentMsg, setCommitmentMsg] = useState('');
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [newSession, setNewSession] = useState({
    date: '',
    tomorrow_commitment: '',
    commitment_minimum: '',
    commitment_stretch: '',
    commitment_score: '',
    is_complete: true,
  });
  const [insertingSession, setInsertingSession] = useState(false);

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

  useEffect(() => {
    if (isAdmin) {
      loadCommitmentRows();
    }
  }, [isAdmin]);

  // ── Load tab data when tab changes ────────────────────────────────────────

  useEffect(() => {
    if (!isAdmin || activeTab === 'sessions') return;
    loadTabData(activeTab);
  }, [activeTab, isAdmin]);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await adminFetch({
        action: 'data',
        user_id: user.id,
        table: 'reflection_sessions',
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
      const res = await adminFetch({
        action: 'data',
        user_id: user.id,
        table: tab,
      });
      const json = await res.json();
      setTabData(json.data || []);
    } catch (_e) {}
    setLoading(false);
  }

  async function loadCommitmentRows() {
    setCommitmentLoading(true);
    setCommitmentMsg('');
    try {
      const res = await adminFetch({
        action: 'data',
        user_id: user.id,
        table: 'reflection_sessions',
      });
      const json = await res.json();
      const rows = (json.data || []).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setCommitmentRows(rows);

      const initialEdits = {};
      for (const row of rows) {
        initialEdits[row.id] = {
          tomorrow_commitment: row.tomorrow_commitment || '',
          commitment_minimum: row.commitment_minimum || '',
          commitment_stretch: row.commitment_stretch || '',
          commitment_score: row.commitment_score ?? '',
          is_complete: row.is_complete ?? false,
          date: row.date || '',
        };
      }
      setCommitmentEdits(initialEdits);
    } catch (_e) {
      setCommitmentMsg('Failed to load sessions');
    }
    setCommitmentLoading(false);
  }

  async function saveCommitmentRow(rowId) {
    const edits = commitmentEdits[rowId];
    if (!edits) return;
    setCommitmentSaving((s) => ({ ...s, [rowId]: true }));
    setCommitmentMsg('');
    try {
      const updates = {
        tomorrow_commitment: edits.tomorrow_commitment || null,
        commitment_minimum: edits.commitment_minimum || null,
        commitment_stretch: edits.commitment_stretch || null,
        commitment_score: edits.commitment_score !== '' ? Number(edits.commitment_score) : null,
        is_complete: edits.is_complete,
        date: edits.date,
      };
      const res = await adminFetch({
        action: 'upsert',
        user_id: user.id,
        table: 'reflection_sessions',
        row_id: rowId,
        updates,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Save failed');
      setCommitmentMsg(`✓ Saved row ${rowId.slice(0, 8)}…`);
      setCommitmentRows((rows) =>
        rows.map((r) => (r.id === rowId ? { ...r, ...updates } : r))
      );
    } catch (e) {
      setCommitmentMsg(`Error: ${e.message}`);
    }
    setCommitmentSaving((s) => ({ ...s, [rowId]: false }));
  }

  function updateCommitmentEdit(rowId, field, value) {
    setCommitmentEdits((prev) => ({
      ...prev,
      [rowId]: { ...prev[rowId], [field]: value },
    }));
    if (highlightedRowId === rowId) {
      setHighlightedRowId(null);
    }
  }

  async function insertFakeSession() {
    if (!newSession.date) {
      setCommitmentMsg('Date is required');
      return;
    }
    const dateParts = newSession.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateParts) {
      setCommitmentMsg('Date must be a valid YYYY-MM-DD value');
      return;
    }
    const year = Number(dateParts[1]);
    const month = Number(dateParts[2]);
    const day = Number(dateParts[3]);
    const validatedDate = new Date(Date.UTC(year, month - 1, day));
    const isValidDate = (
      validatedDate.getUTCFullYear() === year &&
      validatedDate.getUTCMonth() === month - 1 &&
      validatedDate.getUTCDate() === day
    );
    if (!isValidDate) {
      setCommitmentMsg('Date must be a real calendar date');
      return;
    }

    const scoreInput = String(newSession.commitment_score ?? '').trim();
    if (scoreInput !== '' && !/^\d+(\.\d+)?$/.test(scoreInput)) {
      setCommitmentMsg('Score must be numeric');
      return;
    }
    const parsedScore = scoreInput !== '' ? Number(scoreInput) : null;
    if (parsedScore !== null && (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100)) {
      setCommitmentMsg('Score must be a number between 0 and 100');
      return;
    }
    setInsertingSession(true);
    setCommitmentMsg('');
    try {
      const row = {
        date: newSession.date,
        tomorrow_commitment: newSession.tomorrow_commitment || null,
        commitment_minimum: newSession.commitment_minimum || null,
        commitment_stretch: newSession.commitment_stretch || null,
        commitment_score: parsedScore,
        is_complete: newSession.is_complete,
        current_stage: 'complete',
      };
      const res = await adminFetch({
        action: 'insert',
        user_id: user.id,
        table: 'reflection_sessions',
        row,
      });
      const json = await res.json();
      if (res.status === 409 && json.code === 'DUPLICATE_DATE') {
        const conflictingRow = commitmentRows.find((existingRow) => existingRow.date === newSession.date);
        setCommitmentMsg('A session already exists for that date. Scroll down to edit it instead.');
        if (conflictingRow?.id) {
          setHighlightedRowId(conflictingRow.id);
          window.setTimeout(() => {
            setHighlightedRowId((currentId) => (currentId === conflictingRow.id ? null : currentId));
          }, 4000);
          window.requestAnimationFrame(() => {
            const targetRow = document.getElementById(`commitment-row-${conflictingRow.id}`);
            targetRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
        return;
      }
      if (!json.ok) throw new Error(json.error || 'Insert failed');
      setCommitmentMsg('✓ Session inserted');
      setNewSession({
        date: '',
        tomorrow_commitment: '',
        commitment_minimum: '',
        commitment_stretch: '',
        commitment_score: '',
        is_complete: true,
      });
      await loadCommitmentRows();
    } catch (e) {
      setCommitmentMsg(`Error: ${e.message}`);
    }
    setInsertingSession(false);
  }

  async function deleteTabRow(id) {
    if (!confirm('Delete this row?')) return;
    try {
      await adminFetch({
        action: 'data',
        user_id: user.id,
        table: activeTab,
        delete_id: id,
      });
      setTabData((prev) => prev.filter((r) => r.id !== id));
    } catch (_e) {}
  }

  async function deleteSession(id) {
    if (!confirm('Delete this session and its messages?')) return;
    try {
      await adminFetch({
        action: 'data',
        user_id: user.id,
        table: 'reflection_sessions',
        delete_id: id,
      });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (_e) {}
  }

  // ── Reset today ───────────────────────────────────────────────────────────

  async function handleResetToday() {
    if (!confirm("Reset today's reflection session? This deletes it and all its messages.")) return;
    setResultMsg('');
    try {
      const res = await adminFetch({ action: 'reset', user_id: user.id, target_date: localDateStr() });
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
      const res = await adminFetch({ action: 'reset', user_id: user.id, delete_all: true });
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
          <button
            onClick={() => navigate('/demo-builder')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
          >
            <Play className="w-4 h-4" />
            Demo Builder
          </button>
          <button
            onClick={() => navigate('/ui-editor')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
          >
            <WandSparkles className="w-4 h-4 text-red-400" />
            <span className="text-left">
              <span className="block">Visual UI Editor</span>
              <span className="block text-[11px] text-zinc-500">Edit any captured UI snapshot with direct manipulation.</span>
            </span>
          </button>
          <button
            onClick={() => navigate('/video-export')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
          >
            <Video className="w-4 h-4 text-blue-400" />
            Video Export
          </button>
        </div>

        <AdminToolsNav />

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

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-red-400" />
              <h3 className="text-white font-semibold text-base">Commitment Editor</h3>
            </div>
            <button
              onClick={loadCommitmentRows}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload
            </button>
          </div>

          {commitmentMsg && (
            <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-300">
              {commitmentMsg}
            </div>
          )}

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            <p className="text-zinc-300 text-sm font-medium">Add Fake Session</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs text-zinc-400">Date *</span>
                <input
                  type="date"
                  value={newSession.date}
                  onChange={(e) => setNewSession((s) => ({ ...s, date: e.target.value }))}
                  className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-zinc-400">Score (0–100)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={newSession.commitment_score}
                  onChange={(e) => setNewSession((s) => ({ ...s, commitment_score: e.target.value }))}
                  className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                />
              </label>
              <label className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  checked={newSession.is_complete}
                  onChange={(e) => setNewSession((s) => ({ ...s, is_complete: e.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-red-600"
                />
                <span className="text-sm text-zinc-300">Is Complete</span>
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-xs text-zinc-400">Commitment</span>
              <input
                type="text"
                value={newSession.tomorrow_commitment}
                onChange={(e) => setNewSession((s) => ({ ...s, tomorrow_commitment: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-zinc-400">Minimum</span>
                <input
                  type="text"
                  value={newSession.commitment_minimum}
                  onChange={(e) => setNewSession((s) => ({ ...s, commitment_minimum: e.target.value }))}
                  className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-zinc-400">Stretch</span>
                <input
                  type="text"
                  value={newSession.commitment_stretch}
                  onChange={(e) => setNewSession((s) => ({ ...s, commitment_stretch: e.target.value }))}
                  className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                />
              </label>
            </div>
            <button
              onClick={insertFakeSession}
              disabled={insertingSession}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
            >
              {insertingSession ? 'Inserting...' : '+ Insert Session'}
            </button>
          </div>

          {commitmentLoading ? (
            <div className="flex items-center gap-3 py-6 justify-center">
              <div className="w-5 h-5 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
              <span className="text-zinc-500 text-sm">Loading...</span>
            </div>
          ) : commitmentRows.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-6">No sessions found</p>
          ) : (
            <div className="space-y-3">
              {commitmentRows.map((row) => {
                const rowEdits = commitmentEdits[row.id] || {};
                return (
                  <div
                    key={row.id}
                    id={`commitment-row-${row.id}`}
                    className={`bg-zinc-900 border rounded-xl p-4 space-y-3 transition-colors ${
                      row.id === highlightedRowId ? 'border-yellow-500' : 'border-zinc-800'
                    }`}
                  >
                    <div className="text-xs text-zinc-500 font-mono">#{row.id}</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs text-zinc-400">Date</span>
                        <input
                          type="date"
                          value={rowEdits.date || ''}
                          onChange={(e) => {
                            updateCommitmentEdit(row.id, 'date', e.target.value);
                          }}
                          className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-zinc-400">Score</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={rowEdits.commitment_score ?? ''}
                          onChange={(e) => {
                            updateCommitmentEdit(row.id, 'commitment_score', e.target.value);
                          }}
                          className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full sm:max-w-[120px] focus:outline-none focus:border-red-500"
                        />
                      </label>
                    </div>

                    <label className="space-y-1 block">
                      <span className="text-xs text-zinc-400">Commitment</span>
                      <input
                        type="text"
                        value={rowEdits.tomorrow_commitment || ''}
                        onChange={(e) => {
                          updateCommitmentEdit(row.id, 'tomorrow_commitment', e.target.value);
                        }}
                        className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs text-zinc-400">Minimum</span>
                        <input
                          type="text"
                          value={rowEdits.commitment_minimum || ''}
                          onChange={(e) => {
                            updateCommitmentEdit(row.id, 'commitment_minimum', e.target.value);
                          }}
                          className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-zinc-400">Stretch</span>
                        <input
                          type="text"
                          value={rowEdits.commitment_stretch || ''}
                          onChange={(e) => {
                            updateCommitmentEdit(row.id, 'commitment_stretch', e.target.value);
                          }}
                          className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-red-500"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-sm text-zinc-300">
                        <input
                          type="checkbox"
                          checked={!!rowEdits.is_complete}
                          onChange={(e) => {
                            updateCommitmentEdit(row.id, 'is_complete', e.target.checked);
                          }}
                          className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-red-600"
                        />
                        Done
                      </label>
                      <button
                        onClick={() => saveCommitmentRow(row.id)}
                        disabled={!!commitmentSaving[row.id]}
                        className="bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {commitmentSaving[row.id] ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            Saving
                          </span>
                        ) : (
                          'Save'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShellV2>
  );
}
