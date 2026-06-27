import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Trash2, ChevronDown, ChevronRight, RefreshCw, Pencil, Monitor } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';
import { Switch } from '../components/ui/switch';
import {
  fetchGuestGuardrailsEnabled,
  GUEST_GUARDRAILS_CONFIG_KEY,
} from '../lib/guestSession';
import {
  DEFAULT_LIVE_DEMO_SCRIPT,
  LIVE_DEMO_CHANNEL_NAME,
  LIVE_DEMO_DATA_KEY,
  LIVE_DEMO_SCRIPT_KEY,
  normalizeLiveDemoData,
} from '../lib/liveDemo';

const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET;
const GUEST_GUARDRAILS_DESCRIPTION =
  '2-day access window + 7-day cooldown policy for guest campaign users. Set false to bypass all guest timing gates.';

const MAX_WHYS_TOTAL = 5;
const MAX_SESSION_WHYS = 3;
const MAX_COMMITMENT_WHYS = 1;
const MAX_WHY_PROBE_WHYS = 2;
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

function parseTasksFromText(text) {
  if (!text || !text.trim()) return [];
  // Split on:
  //   - ". " followed by uppercase (sentence boundary)
  //   - "; "
  //   - ", and " / ", or "
  //   - " and " / " or " as clause separators (but not inside short phrases)
  const parts = text
    .split(/\.\s+(?=[A-Z])|;\s*|,\s*(?:and|or)\s+|\s+(?:and|or)\s+/i)
    .map((s) => s.replace(/\.\s*$/, '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.trim()];
}

function buildCommitmentFragments({ tomorrowCommitment, commitmentMinimum, commitmentStretch }) {
  const minimum = String(commitmentMinimum || '').trim();
  const stretch = String(commitmentStretch || '').trim();
  const commitment = String(tomorrowCommitment || '').trim();

  // Parse each field independently into individual task fragments
  const minimumTasks = parseTasksFromText(minimum);
  const stretchTasks = parseTasksFromText(stretch);

  const allTasks = [...minimumTasks, ...stretchTasks];

  if (allTasks.length === 0 && commitment) {
    const fallbackTasks = parseTasksFromText(commitment);
    return fallbackTasks.map((task, i) => ({
      commitment_text: task,
      fragment_index: i,
      commitment_type: null,
    }));
  }

  return [
    ...minimumTasks.map((task, i) => ({
      commitment_text: task,
      fragment_index: i,
      commitment_type: 'minimum',
    })),
    ...stretchTasks.map((task, i) => ({
      commitment_text: task,
      fragment_index: minimumTasks.length + i,
      commitment_type: 'stretch',
    })),
  ];
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
  const liveDemoChannelRef = useRef(null);

  const [isAdmin, setIsAdmin] = useState(null); // null = loading
  const [activeTab, setActiveTab] = useState('sessions');
  const [sessions, setSessions] = useState([]);
  const [sessionsVisible, setSessionsVisible] = useState(5);
  const [tabData, setTabData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [commitmentRows, setCommitmentRows] = useState([]);
  const [commitmentsVisible, setCommitmentsVisible] = useState(5);
  const [commitmentLoading, setCommitmentLoading] = useState(false);
  const [commitmentEdits, setCommitmentEdits] = useState({});
  const [commitmentSaving, setCommitmentSaving] = useState({});
  const [commitmentMsg, setCommitmentMsg] = useState('');
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [newSession, setNewSession] = useState({
    date: '',
    commitment_minimum: '',
    commitment_stretch: '',
    commitment_score: '',
    is_complete: true,
  });
  const [insertingSession, setInsertingSession] = useState(false);
  const [rowFragments, setRowFragments] = useState({});
  const [activeGoals, setActiveGoals] = useState([]);
  const [whyInputs, setWhyInputs] = useState({});
  const [whySaving, setWhySaving] = useState({});
  const [whySaved, setWhySaved] = useState({});
  const [goalLinkSaved, setGoalLinkSaved] = useState({});
  const [demoScript, setDemoScript] = useState('');
  const [demoScriptMsg, setDemoScriptMsg] = useState('');
  const [guardrailsEnabled, setGuardrailsEnabled] = useState(true);
  const [guardrailsDraft, setGuardrailsDraft] = useState(true);
  const [guardrailsLoading, setGuardrailsLoading] = useState(false);
  const [guardrailsSaving, setGuardrailsSaving] = useState(false);
  const [guardrailsMsg, setGuardrailsMsg] = useState('');
  const [demoData, setDemoData] = useState({
    goals: [],
    commitmentScore: '',
    streak: '',
    weeklyScores: Array.from({ length: 7 }, () => ({ score: '', status: '' })),
    yesterdayCommitment: { text: '', status: 'pending', minimum: '', stretch: '' },
    keptFragments: [],
    missedFragments: [],
  });
  const [demoDataMsg, setDemoDataMsg] = useState('');

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
      loadGuestGuardrails();
      loadCommitmentRows();
      loadActiveGoals();
    }
  }, [isAdmin]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(LIVE_DEMO_SCRIPT_KEY);
    if (saved) {
      setDemoScript(saved);
    } else {
      setDemoScript(JSON.stringify(DEFAULT_LIVE_DEMO_SCRIPT, null, 2));
    }
    try {
      const savedData = window.localStorage.getItem(LIVE_DEMO_DATA_KEY);
      if (savedData) {
        const parsedDemoData = normalizeLiveDemoData(JSON.parse(savedData));
        setDemoData({
          goals: Array.isArray(parsedDemoData?.goals) ? parsedDemoData.goals : [],
          commitmentScore: parsedDemoData?.commitmentScore != null ? String(parsedDemoData.commitmentScore) : '',
          streak: parsedDemoData?.streak != null ? String(parsedDemoData.streak) : '',
          weeklyScores: Array.from({ length: 7 }, (_, i) => ({
            score: parsedDemoData?.weeklyScores?.[i]?.score != null ? String(parsedDemoData.weeklyScores[i].score) : '',
            status: typeof parsedDemoData?.weeklyScores?.[i]?.status === 'string'
              ? parsedDemoData.weeklyScores[i].status
              : '',
          })),
          yesterdayCommitment: {
            text: parsedDemoData?.yesterdayCommitment?.text ?? '',
            status: parsedDemoData?.yesterdayCommitment?.status ?? 'pending',
            minimum: parsedDemoData?.yesterdayCommitment?.minimum ?? '',
            stretch: parsedDemoData?.yesterdayCommitment?.stretch ?? '',
          },
          keptFragments: Array.isArray(parsedDemoData?.keptFragments)
            ? parsedDemoData.keptFragments
            : [],
          missedFragments: Array.isArray(parsedDemoData?.missedFragments)
            ? parsedDemoData.missedFragments
            : [],
        });
      }
    } catch (_e) {}
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    liveDemoChannelRef.current = new BroadcastChannel(LIVE_DEMO_CHANNEL_NAME);
    return () => {
      liveDemoChannelRef.current?.close();
      liveDemoChannelRef.current = null;
    };
  }, []);

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

  async function loadGuestGuardrails() {
    setGuardrailsLoading(true);
    const enabled = await fetchGuestGuardrailsEnabled(supabase);
    setGuardrailsEnabled(enabled);
    setGuardrailsDraft(enabled);
    setGuardrailsLoading(false);
  }

  async function saveGuestGuardrails() {
    if (!user?.id) return;
    setGuardrailsSaving(true);
    setGuardrailsMsg('');
    const { error } = await supabase
      .from('app_config')
      .upsert(
        {
          key: GUEST_GUARDRAILS_CONFIG_KEY,
          value: guardrailsDraft,
          description: GUEST_GUARDRAILS_DESCRIPTION,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        },
        { onConflict: 'key' }
      );

    if (error) {
      setGuardrailsMsg('Failed to save guest guardrails.');
    } else {
      setGuardrailsEnabled(guardrailsDraft);
      setGuardrailsMsg('Guest guardrails updated.');
    }
    setGuardrailsSaving(false);
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
          commitment_minimum: row.commitment_minimum || '',
          commitment_stretch: row.commitment_stretch || '',
          commitment_score: row.commitment_score ?? '',
          is_complete: row.is_complete ?? false,
          date: row.date || '',
        };
      }
      setCommitmentEdits(initialEdits);

      const sessionIds = rows.map((r) => r.id).filter(Boolean);
      if (sessionIds.length > 0) {
        const { data: fragData } = await supabase
          .from('goal_commitment_log')
          .select('id, session_id, commitment_text, commitment_type, kept, goal_id, fragment_index')
          .eq('user_id', user.id)
          .in('session_id', sessionIds)
          .order('fragment_index', { ascending: true });
        const fragMap = {};
        for (const frag of (fragData || [])) {
          if (!fragMap[frag.session_id]) fragMap[frag.session_id] = [];
          fragMap[frag.session_id].push(frag);
        }
        setRowFragments(fragMap);
      }
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
      const originalRow = commitmentRows.find((row) => row.id === rowId) || null;
      const updates = {
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
      await syncCommitmentFragments({
        sessionId: rowId,
        sessionDate: updates.date,
        previousSessionDate: originalRow?.date || null,
        tomorrowCommitment: null,
        commitmentMinimum: updates.commitment_minimum,
        commitmentStretch: updates.commitment_stretch,
      });
      await loadFragmentsForSession(rowId);
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

  async function loadActiveGoals() {
    try {
      const res = await adminFetch({
        action: 'data',
        user_id: user.id,
        table: 'goals',
      });
      const json = await res.json();
      setActiveGoals((json.data || []).filter((g) => g.status === 'active'));
    } catch (_e) {
      console.error('loadActiveGoals failed', _e);
    }
  }

  async function loadFragmentsForSession(sessionId) {
    try {
      const { data } = await supabase
        .from('goal_commitment_log')
        .select('id, session_id, commitment_text, commitment_type, kept, goal_id, fragment_index')
        .eq('user_id', user.id)
        .eq('session_id', sessionId)
        .order('fragment_index', { ascending: true });
      setRowFragments((prev) => ({ ...prev, [sessionId]: data || [] }));
    } catch (_e) {
      console.error('loadFragmentsForSession failed', _e);
    }
  }

  function getLatestWhyText(goal) {
    if (!goal || !Array.isArray(goal.whys) || goal.whys.length === 0) return null;
    return goal.whys[goal.whys.length - 1].text;
  }

  async function linkGoalToFragment(fragmentId, goalId, sessionId) {
    const newGoalId = goalId || null;
    setRowFragments((prev) => {
      const frags = (prev[sessionId] || []).map((f) =>
        f.id === fragmentId ? { ...f, goal_id: newGoalId } : f
      );
      return { ...prev, [sessionId]: frags };
    });
    try {
      await adminFetch({
        action: 'upsert',
        user_id: user.id,
        table: 'goal_commitment_log',
        row_id: fragmentId,
        updates: { goal_id: newGoalId },
      });
      setGoalLinkSaved((prev) => ({ ...prev, [fragmentId]: true }));
      window.setTimeout(() => {
        setGoalLinkSaved((prev) => ({ ...prev, [fragmentId]: false }));
      }, 1500);
      const goal = newGoalId ? activeGoals.find((g) => g.id === newGoalId) : null;
      const latestWhy = getLatestWhyText(goal) || '';
      setWhyInputs((prev) => ({ ...prev, [fragmentId]: latestWhy }));
    } catch (_e) {
      console.error('linkGoalToFragment failed', _e);
    }
  }

  async function saveFragmentWhy(fragmentId, goalId, whyText) {
    if (!goalId || !whyText.trim()) return;
    setWhySaving((prev) => ({ ...prev, [fragmentId]: true }));
    try {
      const { data: goalData } = await supabase
        .from('goals')
        .select('whys')
        .eq('id', goalId)
        .eq('user_id', user.id)
        .single();
      const existingWhys = Array.isArray(goalData?.whys) ? [...goalData.whys] : [];
      const todayDateStr = localDateStr();
      const newEntry = { text: whyText.trim(), added_at: todayDateStr, source: 'admin', motivation_signal: null };
      const latestText = existingWhys.length > 0 ? existingWhys[existingWhys.length - 1].text : null;
      let updatedWhys;
      if (latestText === whyText.trim()) {
        updatedWhys = [...existingWhys.slice(0, -1), newEntry];
      } else {
        updatedWhys = [...existingWhys, newEntry];
      }
      const commitmentWhys = updatedWhys.filter((w) => w.source === 'commitment_planning').slice(-MAX_COMMITMENT_WHYS);
      const probeWhys = updatedWhys.filter((w) => w.source === 'why_probe').slice(-MAX_WHY_PROBE_WHYS);
      const sessionWhys = updatedWhys.filter((w) => w.source !== 'commitment_planning' && w.source !== 'why_probe').slice(-MAX_SESSION_WHYS);
      updatedWhys = [...commitmentWhys, ...probeWhys, ...sessionWhys].slice(-MAX_WHYS_TOTAL);
      await adminFetch({
        action: 'upsert',
        user_id: user.id,
        table: 'goals',
        row_id: goalId,
        updates: { whys: updatedWhys },
      });
      const { data: refreshed } = await supabase
        .from('goals')
        .select('whys')
        .eq('id', goalId)
        .eq('user_id', user.id)
        .single();
      if (refreshed) {
        setActiveGoals((prev) =>
          prev.map((g) => (g.id === goalId ? { ...g, whys: refreshed.whys } : g))
        );
      }
      setWhySaved((prev) => ({ ...prev, [fragmentId]: true }));
      window.setTimeout(() => {
        setWhySaved((prev) => ({ ...prev, [fragmentId]: false }));
      }, 1500);
    } catch (_e) {
      console.error('saveFragmentWhy failed', _e);
    }
    setWhySaving((prev) => ({ ...prev, [fragmentId]: false }));
  }

  async function syncCommitmentFragments({
    sessionId,
    sessionDate,
    previousSessionDate = null,
    tomorrowCommitment,
    commitmentMinimum,
    commitmentStretch,
  }) {
    if (!sessionId || !sessionDate) {
      throw new Error('Cannot sync commitment fragments without a session id and date');
    }

    try {
      const datesToQuery = [...new Set([sessionDate, previousSessionDate].filter(Boolean))];
      const fragments = buildCommitmentFragments({
        tomorrowCommitment,
        commitmentMinimum,
        commitmentStretch,
      });

      let existingRows = [];
      if (datesToQuery.length > 0) {
        const { data } = await supabase
          .from('goal_commitment_log')
          .select('id, session_id, date, commitment_type, fragment_index')
          .eq('user_id', user.id)
          .in('date', datesToQuery);
        existingRows = Array.isArray(data) ? data : [];
      }

      const rowsToDelete = existingRows.filter((row) => {
        if (row.session_id === sessionId) return true;
        if (previousSessionDate && row.date === previousSessionDate) return true;
        // Clean up old, session-less fallback fragments for this date to avoid duplicates.
        if (row.date === sessionDate && !row.session_id) {
          return row.commitment_type === 'minimum'
            || row.commitment_type === 'stretch'
            || row.fragment_index === 0
            || row.fragment_index === 1;
        }
        return false;
      });

      const deleteResults = await Promise.all(
        rowsToDelete.map((row) => adminFetch({
          // Deletions are handled by admin API `data` action with `delete_id`.
          action: 'data',
          user_id: user.id,
          table: 'goal_commitment_log',
          delete_id: row.id,
        }))
      );
      const deletePayloads = await Promise.all(
        deleteResults.map(async (response) => ({
          ok: response.ok,
          json: await response.json(),
        }))
      );
      for (const payload of deletePayloads) {
        if (!payload.ok || payload.json.ok !== true) {
          throw new Error(payload.json.error || 'Failed to delete existing commitment fragments');
        }
      }

      if (fragments.length === 0) return;

      const insertResults = await Promise.all(
        fragments.map((fragment) => adminFetch({
          action: 'insert',
          user_id: user.id,
          table: 'goal_commitment_log',
          row: {
            session_id: sessionId,
            date: sessionDate,
            commitment_text: fragment.commitment_text,
            fragment_index: fragment.fragment_index,
            commitment_type: fragment.commitment_type,
            kept: null,
          },
        }))
      );
      const insertPayloads = await Promise.all(
        insertResults.map(async (response) => ({
          ok: response.ok,
          json: await response.json(),
        }))
      );
      for (const payload of insertPayloads) {
        if (!payload.ok || payload.json.ok !== true) {
          throw new Error(payload.json.error || 'Failed to insert commitment fragments');
        }
      }
    } catch (error) {
      throw new Error(`Commitment fragment sync failed: ${error.message || 'unknown error'}`);
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
      const insertedRow = Array.isArray(json.data) ? json.data[0] : null;
      if (insertedRow?.id) {
        await syncCommitmentFragments({
          sessionId: insertedRow.id,
          sessionDate: row.date,
          tomorrowCommitment: null,
          commitmentMinimum: row.commitment_minimum,
          commitmentStretch: row.commitment_stretch,
        });
      }
      setCommitmentMsg('✓ Session inserted');
      setNewSession({
        date: '',
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

  function saveDemoData(data) {
    const toSave = normalizeLiveDemoData(data);
    window.localStorage.setItem(LIVE_DEMO_DATA_KEY, JSON.stringify(toSave));
    try {
      const ch = new BroadcastChannel(LIVE_DEMO_CHANNEL_NAME);
      ch.postMessage({ type: 'UPDATE_DEMO_DATA' });
      ch.close();
    } catch (_e) {}
    setDemoDataMsg('✓ Saved');
    setTimeout(() => setDemoDataMsg(''), 2000);
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
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-white font-semibold text-base">Guest Guardrails</h3>
              <p className="text-sm text-zinc-400 max-w-2xl">
                Toggle the guest timing policy for `/start/guest`. When disabled, guest users bypass the
                2-day access window, cooldown, and signup gate.
              </p>
            </div>
            <Switch
              checked={guardrailsDraft}
              onCheckedChange={setGuardrailsDraft}
              disabled={guardrailsLoading || guardrailsSaving}
              aria-label="Toggle guest guardrails"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                guardrailsDraft
                  ? 'bg-emerald-900/30 border-emerald-800 text-emerald-300'
                  : 'bg-amber-900/30 border-amber-800 text-amber-300'
              }`}
            >
              {guardrailsDraft ? 'Guardrails enabled' : 'Guardrails disabled'}
            </span>
            <button
              onClick={saveGuestGuardrails}
              disabled={guardrailsLoading || guardrailsSaving || guardrailsDraft === guardrailsEnabled}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardrailsSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={loadGuestGuardrails}
              disabled={guardrailsLoading || guardrailsSaving}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardrailsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {guardrailsMsg && (
            <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-300">
              {guardrailsMsg}
            </div>
          )}
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-emerald-400" />
              <h3 className="text-white font-semibold text-base">Live Demo Script</h3>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => window.open('/admin/live-demo', '_blank')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-900/40 border border-emerald-800 text-emerald-300 hover:bg-emerald-900 text-sm transition-colors"
              >
                <Monitor className="w-3.5 h-3.5" />
                Open Demo
              </button>
              <button
                onClick={() => {
                  try {
                    const parsed = JSON.parse(demoScript);
                    const isOldFormat = Array.isArray(parsed);
                    const isNewFormat = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.turns);
                    if (!isOldFormat && !isNewFormat) {
                      throw new Error('Invalid script format');
                    }
                    if (isNewFormat && parsed.checklist !== undefined && !Array.isArray(parsed.checklist)) {
                      throw new Error('Invalid checklist format');
                    }
                    if (isNewFormat && parsed.stageOrder !== undefined && !Array.isArray(parsed.stageOrder)) {
                      throw new Error('Invalid stageOrder format — must be an array');
                    }
                    window.localStorage.setItem(LIVE_DEMO_SCRIPT_KEY, demoScript);
                    liveDemoChannelRef.current?.postMessage({ type: 'UPDATE_DEMO_SCRIPT' });
                    setDemoScriptMsg('✓ Script saved');
                    setTimeout(() => setDemoScriptMsg(''), 2000);
                  } catch (_e) {
                    setDemoScriptMsg('⚠ Invalid JSON — fix errors before saving');
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors"
              >
                Save Script
              </button>
              <button
                onClick={() => {
                  setDemoScript(JSON.stringify(DEFAULT_LIVE_DEMO_SCRIPT, null, 2));
                  setDemoScriptMsg('Reset to default');
                  setTimeout(() => setDemoScriptMsg(''), 2000);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-zinc-700 text-sm transition-colors"
              >
                Reset Default
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => liveDemoChannelRef.current?.postMessage({ type: 'PLAY' })}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 text-sm transition-colors"
            >
              ▶ Play Demo
            </button>
            <button
              onClick={() => liveDemoChannelRef.current?.postMessage({ type: 'RESET' })}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors"
            >
              ⏹ Reset Demo
            </button>
            <span className="text-zinc-500 text-xs">Controls the Live Demo tab if it's open in another window.</span>
          </div>

          <p className="text-zinc-500 text-xs">
            Script format: <code className="text-zinc-400">{'{ "stageOrder?": ["commitment_checkin","honest","wins","tomorrow"], "checklist": [{ "label": "...", "checked": false }], "turns": [...] }'}</code>. Each turn: <code className="text-zinc-400">{'{ "role": "coach"|"user", "content": "...", "stage?": "commitment_checkin|wins|honest|tomorrow", "checkItem?": [0,1] }'}</code>. <code className="text-zinc-400">stageOrder</code> is optional — omit it to derive order from first stage appearance in turns.
          </p>

          {demoScriptMsg && (
            <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-300">
              {demoScriptMsg}
            </div>
          )}

          <textarea
            value={demoScript}
            onChange={(e) => setDemoScript(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-xs text-zinc-200 font-mono resize-none focus:outline-none focus:border-zinc-500 transition-colors"
            rows={20}
            spellCheck={false}
          />
        </div>

        {/* Demo Data card */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-emerald-400" />
            <h3 className="text-white font-semibold text-base">Demo Data</h3>
          </div>

          {demoDataMsg && (
            <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-300">
              {demoDataMsg}
            </div>
          )}

          {/* Commitment Score */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Commitment Score (0–100)</label>
            <input
              type="number"
              min="0"
              max="100"
              value={demoData.commitmentScore}
              onChange={(e) => setDemoData((d) => ({ ...d, commitmentScore: e.target.value }))}
              className="w-full sm:max-w-[160px] bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors block"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Streak (nights)</label>
            <input
              type="number"
              min="0"
              value={demoData.streak}
              onChange={(e) => setDemoData((d) => ({ ...d, streak: e.target.value }))}
              className="w-full sm:max-w-[160px] bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors block"
            />
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-xs text-zinc-400 font-medium">Weekly Scores (Mon–Sun)</p>
              <p className="text-[11px] text-zinc-500">Controls the consistency graph in insights</p>
            </div>
            <div className="space-y-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                <div key={day} className="flex items-center gap-2">
                  <p className="text-zinc-400 text-xs w-10">{day}</p>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={demoData.weeklyScores?.[i]?.score ?? ''}
                    onChange={(e) => {
                      const score = e.target.value;
                      setDemoData((d) => {
                        const weeklyScores = Array.from({ length: 7 }, (_, idx) => ({
                          score: d.weeklyScores?.[idx]?.score ?? '',
                          status: d.weeklyScores?.[idx]?.status ?? '',
                        }));
                        weeklyScores[i] = { ...weeklyScores[i], score };
                        return { ...d, weeklyScores };
                      });
                    }}
                    className="w-20 bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                  <select
                    value={demoData.weeklyScores?.[i]?.status ?? ''}
                    onChange={(e) => {
                      const status = e.target.value;
                      setDemoData((d) => {
                        const weeklyScores = Array.from({ length: 7 }, (_, idx) => ({
                          score: d.weeklyScores?.[idx]?.score ?? '',
                          status: d.weeklyScores?.[idx]?.status ?? '',
                        }));
                        weeklyScores[i] = { ...weeklyScores[i], status };
                        return { ...d, weeklyScores };
                      });
                    }}
                    className="flex-1 bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500 transition-colors"
                  >
                    <option value="">—</option>
                    <option value="kept">kept</option>
                    <option value="missed">missed</option>
                    <option value="pending">pending</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">Yesterday&apos;s Commitment</p>
            <input
              type="text"
              value={demoData.yesterdayCommitment?.text ?? ''}
              placeholder="Commitment text"
              onChange={(e) => {
                const text = e.target.value;
                setDemoData((d) => ({
                  ...d,
                  yesterdayCommitment: { ...d.yesterdayCommitment, text },
                }));
              }}
              className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            <div className="grid sm:grid-cols-3 gap-2">
              <select
                value={demoData.yesterdayCommitment?.status ?? 'pending'}
                onChange={(e) => {
                  const status = e.target.value;
                  setDemoData((d) => ({
                    ...d,
                    yesterdayCommitment: { ...d.yesterdayCommitment, status },
                  }));
                }}
                className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
              >
                <option value="pending">pending</option>
                <option value="kept">kept</option>
                <option value="missed">missed</option>
              </select>
              <input
                type="text"
                value={demoData.yesterdayCommitment?.minimum ?? ''}
                placeholder="Minimum"
                onChange={(e) => {
                  const minimum = e.target.value;
                  setDemoData((d) => ({
                    ...d,
                    yesterdayCommitment: { ...d.yesterdayCommitment, minimum },
                  }));
                }}
                className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
              />
              <input
                type="text"
                value={demoData.yesterdayCommitment?.stretch ?? ''}
                placeholder="Stretch"
                onChange={(e) => {
                  const stretch = e.target.value;
                  setDemoData((d) => ({
                    ...d,
                    yesterdayCommitment: { ...d.yesterdayCommitment, stretch },
                  }));
                }}
                className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">Kept Commitments (shown in Insights)</p>
            <div className="space-y-3">
              {demoData.keptFragments.map((fragment, i) => (
                <div key={`kept-fragment-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                  <input
                    type="text"
                    value={fragment.text}
                    placeholder="Commitment text"
                    onChange={(e) => {
                      const text = e.target.value;
                      setDemoData((d) => {
                        const keptFragments = [...d.keptFragments];
                        keptFragments[i] = { ...keptFragments[i], text };
                        return { ...d, keptFragments };
                      });
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                  <input
                    type="text"
                    value={fragment.goalTitle || ''}
                    placeholder="Goal title (optional)"
                    onChange={(e) => {
                      const goalTitle = e.target.value;
                      setDemoData((d) => {
                        const keptFragments = [...d.keptFragments];
                        keptFragments[i] = { ...keptFragments[i], goalTitle };
                        return { ...d, keptFragments };
                      });
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={fragment.goalWhy || ''}
                      placeholder="Goal why (optional)"
                      onChange={(e) => {
                        const goalWhy = e.target.value;
                        setDemoData((d) => {
                          const keptFragments = [...d.keptFragments];
                          keptFragments[i] = { ...keptFragments[i], goalWhy };
                          return { ...d, keptFragments };
                        });
                      }}
                      className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                    />
                    <button
                      onClick={() => {
                        setDemoData((d) => ({
                          ...d,
                          keptFragments: d.keptFragments.filter((_, idx) => idx !== i),
                        }));
                      }}
                      className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setDemoData((d) => ({
                  ...d,
                  keptFragments: [...d.keptFragments, { text: '', goalTitle: '', goalWhy: '' }],
                }))
              }
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700"
            >
              + Add kept
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">Missed Commitments (shown in Insights)</p>
            <div className="space-y-3">
              {demoData.missedFragments.map((fragment, i) => (
                <div key={`missed-fragment-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                  <input
                    type="text"
                    value={fragment.text}
                    placeholder="Commitment text"
                    onChange={(e) => {
                      const text = e.target.value;
                      setDemoData((d) => {
                        const missedFragments = [...d.missedFragments];
                        missedFragments[i] = { ...missedFragments[i], text };
                        return { ...d, missedFragments };
                      });
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                  <input
                    type="text"
                    value={fragment.goalTitle || ''}
                    placeholder="Goal title (optional)"
                    onChange={(e) => {
                      const goalTitle = e.target.value;
                      setDemoData((d) => {
                        const missedFragments = [...d.missedFragments];
                        missedFragments[i] = { ...missedFragments[i], goalTitle };
                        return { ...d, missedFragments };
                      });
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={fragment.goalWhy || ''}
                      placeholder="Goal why (optional)"
                      onChange={(e) => {
                        const goalWhy = e.target.value;
                        setDemoData((d) => {
                          const missedFragments = [...d.missedFragments];
                          missedFragments[i] = { ...missedFragments[i], goalWhy };
                          return { ...d, missedFragments };
                        });
                      }}
                      className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                    />
                    <button
                      onClick={() => {
                        setDemoData((d) => ({
                          ...d,
                          missedFragments: d.missedFragments.filter((_, idx) => idx !== i),
                        }));
                      }}
                      className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setDemoData((d) => ({
                  ...d,
                  missedFragments: [...d.missedFragments, { text: '', goalTitle: '', goalWhy: '' }],
                }))
              }
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700"
            >
              + Add missed
            </button>
          </div>

          {/* Goals */}
          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">Goals</p>
            <div className="space-y-3">
              {demoData.goals.map((goal, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={goal.title}
                        placeholder="Goal title"
                        onChange={(e) => {
                          const title = e.target.value;
                          setDemoData((d) => {
                            const goals = [...d.goals];
                            goals[i] = { ...goals[i], title };
                            return { ...d, goals };
                          });
                        }}
                        className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                      />
                      <input
                        type="text"
                        value={goal.why}
                        placeholder="Why (reason)"
                        onChange={(e) => {
                          const why = e.target.value;
                          setDemoData((d) => {
                            const goals = [...d.goals];
                            goals[i] = { ...goals[i], why };
                            return { ...d, goals };
                          });
                        }}
                        className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setDemoData((d) => {
                          const goals = d.goals.filter((_, idx) => idx !== i);
                          return { ...d, goals };
                        });
                      }}
                      className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-900/20 transition-colors flex-shrink-0 mt-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setDemoData((d) => ({ ...d, goals: [...d.goals, { title: '', why: '' }] }))}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700"
            >
              + Add goal
            </button>
          </div>

          <button
            onClick={() => saveDemoData(demoData)}
            className="bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-xl transition-colors"
          >
            Save Demo Data
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
              <>
                {sessions.slice(0, sessionsVisible).map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    userId={user.id}
                    onDelete={deleteSession}
                    isToday={session.date === todayStr}
                  />
                ))}
                {sessions.length > sessionsVisible && (
                  <button
                    onClick={() => setSessionsVisible((v) => v + 5)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors mt-3"
                  >
                    Show 5 more
                  </button>
                )}
              </>
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
              <span className="text-xs text-zinc-400">Commitment <span className="text-zinc-600">(read-only)</span></span>
              <p className="bg-zinc-950 text-zinc-400 text-sm rounded-lg px-2 py-1.5 min-h-[2rem]">
                {(() => {
                  const assembledCommitment = [
                    newSession.commitment_minimum && `Minimum: ${newSession.commitment_minimum}`,
                    newSession.commitment_stretch && `Stretch: ${newSession.commitment_stretch}`,
                  ].filter(Boolean).join(' | ') || null;
                  return assembledCommitment || <span className="italic text-zinc-600">Fill in Minimum and/or Stretch above</span>;
                })()}
              </p>
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
              {commitmentRows.slice(0, commitmentsVisible).map((row) => {
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
                      <span className="text-xs text-zinc-400">Commitment <span className="text-zinc-600">(read-only)</span></span>
                      <p className="bg-zinc-950 text-zinc-400 text-sm rounded-lg px-2 py-1.5 min-h-[2rem]">
                        {(() => {
                          const assembledCommitment = [
                            rowEdits.commitment_minimum && `Minimum: ${rowEdits.commitment_minimum}`,
                            rowEdits.commitment_stretch && `Stretch: ${rowEdits.commitment_stretch}`,
                          ].filter(Boolean).join(' | ') || row.tomorrow_commitment || null;
                          return assembledCommitment || <span className="italic text-zinc-600">Fill in Minimum and/or Stretch above</span>;
                        })()}
                      </p>
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

                    {/* Fragment list */}
                    {(rowFragments[row.id] || []).length > 0 && (
                      <div className="mt-1 pt-3 border-t border-zinc-800 space-y-3">
                        {(rowFragments[row.id] || []).map((frag) => {
                          const linkedGoal = frag.goal_id ? activeGoals.find((g) => g.id === frag.goal_id) : null;
                          const latestWhy = getLatestWhyText(linkedGoal);
                          const whyInput = whyInputs[frag.id] !== undefined ? whyInputs[frag.id] : (latestWhy || '');
                          const keptLabel = frag.kept === true ? '✓ kept' : frag.kept === false ? '✗ missed' : '… pending';
                          const keptClass = frag.kept === true ? 'text-green-400' : frag.kept === false ? 'text-red-400' : 'text-zinc-500';
                          return (
                            <div key={frag.id} className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2">
                              <div className="flex items-start gap-2 flex-wrap">
                                <span className="text-zinc-200 text-sm flex-1 min-w-0">{frag.commitment_text}</span>
                                {frag.commitment_type && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                                    frag.commitment_type === 'minimum'
                                      ? 'bg-blue-900/50 text-blue-300 border border-blue-800'
                                      : 'bg-purple-900/50 text-purple-300 border border-purple-800'
                                  }`}>
                                    {frag.commitment_type}
                                  </span>
                                )}
                                <span className={`text-xs flex-shrink-0 ${keptClass}`}>{keptLabel}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={frag.goal_id || ''}
                                  onChange={(e) => linkGoalToFragment(frag.id, e.target.value || null, row.id)}
                                  className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-red-500"
                                >
                                  <option value="">— Link a goal —</option>
                                  {activeGoals.map((g) => (
                                    <option key={g.id} value={g.id}>{g.title}</option>
                                  ))}
                                </select>
                                {goalLinkSaved[frag.id] && (
                                  <span className="text-green-400 text-xs flex-shrink-0">✓</span>
                                )}
                              </div>
                              {frag.goal_id && (
                                <div className="space-y-1.5">
                                  {latestWhy && (
                                    <p className="text-xs text-zinc-500 italic">Current why: &ldquo;{latestWhy}&rdquo;</p>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      placeholder="Add / update why"
                                      value={whyInput}
                                      onChange={(e) =>
                                        setWhyInputs((prev) => ({ ...prev, [frag.id]: e.target.value }))
                                      }
                                      className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-red-500 placeholder-zinc-600"
                                    />
                                    <button
                                      onClick={() => saveFragmentWhy(frag.id, frag.goal_id, whyInput)}
                                      disabled={!!whySaving[frag.id] || !whyInput.trim()}
                                      className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs px-2 py-1.5 rounded-lg transition-colors flex-shrink-0"
                                    >
                                      {whySaving[frag.id] ? '…' : 'Save Why'}
                                    </button>
                                    {whySaved[frag.id] && (
                                      <span className="text-green-400 text-xs flex-shrink-0">✓</span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {commitmentRows.length > commitmentsVisible && (
                <button
                  onClick={() => setCommitmentsVisible((v) => v + 5)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors mt-3"
                >
                  Show 5 more
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShellV2>
  );
}
