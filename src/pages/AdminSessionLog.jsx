import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, ChevronDown, ChevronUp, Download, RefreshCw, ScrollText } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import AppShellV2 from '../components/v2/AppShellV2';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'real', label: 'Real' },
  { value: 'sim', label: 'Sim' },
];

const EVENT_TYPE_STYLES = {
  classifier_output: 'bg-indigo-900/40 border-indigo-800 text-indigo-300',
  exercise_fire: 'bg-rose-900/40 border-rose-800 text-rose-300',
  stage_shift: 'bg-amber-900/40 border-amber-800 text-amber-300',
  directive_dispatch: 'bg-zinc-800 border-zinc-700 text-zinc-300',
  ai_reasoning: 'bg-purple-900/40 border-purple-800 text-purple-300',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function downloadSessionJson(session, detail) {
  if (!session || !detail) return;
  const payload = {
    session,
    messages: detail.messages || [],
    thinking_events: detail.thinkingEvents || [],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const datePart = (session.created_at || session.date || 'unknown-date').slice(0, 10);
  link.href = url;
  link.download = `session-${session.id}-${datePart}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderThinkingEvent(event) {
  switch (event.event_type) {
    case 'classifier_output':
      return (
        <div className="space-y-1 text-sm text-zinc-300">
          <p>intent={event.classifier_intent || '—'} | emotional_state={event.classifier_emotional_state || '—'} | suggested_exercise={event.classifier_suggested_exercise || 'none'}</p>
          <p>energy_type={event.classifier_energy_type || '—'} | depth_opportunity={event.classifier_depth_opportunity ? 'true' : 'false'}</p>
        </div>
      );
    case 'exercise_fire':
      return (
        <div className="space-y-1 text-sm text-zinc-300">
          <p>Exercise: <span className="text-white">{event.exercise_label || '—'}</span> ({event.exercise_id || '—'})</p>
          <p>Trigger path: {event.exercise_trigger_path || '—'}</p>
        </div>
      );
    case 'stage_shift':
      return (
        <div className="space-y-1 text-sm text-zinc-300">
          <p><span className="text-white">{event.stage_from || '—'}</span> → <span className="text-white">{event.stage_to || '—'}</span></p>
          <p>Reason: {event.stage_trigger_condition || '—'}</p>
        </div>
      );
    case 'directive_dispatch':
      return (
        <div className="space-y-1 text-sm text-zinc-300">
          <p>Directive: <span className="text-white">{event.directive_type || '—'}</span></p>
          <p>Priority: {event.directive_priority ?? '—'} | Stage: {event.directive_stage || '—'}</p>
          <p className="whitespace-pre-wrap">Reason: {event.directive_reason || '—'}</p>
        </div>
      );
    case 'ai_reasoning':
      return (
        <div className="space-y-1 text-sm text-zinc-300">
          <p><span className="text-zinc-400">Why this question:</span> {event.ai_why_this_question || '—'}</p>
          <p><span className="text-zinc-400">Emotional read:</span> {event.ai_emotional_read || '—'}</p>
          <p><span className="text-zinc-400">Strategic intent:</span> {event.ai_strategic_intent || '—'}</p>
        </div>
      );
    default:
      return <p className="text-sm text-zinc-400">No details available.</p>;
  }
}

export default function AdminSessionLog() {
  /** @type {{ user?: { id?: string } } | null} */
  const auth = useAuth();
  const user = auth?.user;
  const navigate = useNavigate();

  const [isAdmin, setIsAdmin] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [detailsBySession, setDetailsBySession] = useState({});
  const [tabsBySession, setTabsBySession] = useState({});

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (data?.role === 'admin') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          navigate('/reflection', { replace: true });
        }
      } catch (_error) {
        setIsAdmin(false);
        navigate('/reflection', { replace: true });
      }
    })();
  }, [user?.id, navigate]);

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const { data: sessionRows } = await supabase
        .from('reflection_sessions')
        .select('*')
        .order('created_at', { ascending: false });

      const ids = (sessionRows || []).map((session) => session.id);
      let messageRows = [];
      let thinkingRows = [];

      if (ids.length > 0) {
        const [{ data: messagesData }, { data: eventsData }] = await Promise.all([
          supabase.from('reflection_messages').select('session_id, role').in('session_id', ids),
          supabase.from('session_thinking_events').select('session_id, sim_run_id').in('session_id', ids),
        ]);
        messageRows = messagesData || [];
        thinkingRows = eventsData || [];
      }

      const assistantTurnsBySession = {};
      messageRows.forEach((message) => {
        if (message.role === 'assistant') {
          assistantTurnsBySession[message.session_id] = (assistantTurnsBySession[message.session_id] || 0) + 1;
        }
      });

      const simMetaBySession = {};
      thinkingRows.forEach((event) => {
        if (!simMetaBySession[event.session_id]) {
          simMetaBySession[event.session_id] = { isSim: false, simRunId: null };
        }
        if (event.sim_run_id) {
          simMetaBySession[event.session_id] = { isSim: true, simRunId: event.sim_run_id };
        }
      });

      setSessions((sessionRows || []).map((session) => ({
        ...session,
        turn_count: assistantTurnsBySession[session.id] || 0,
        is_sim: simMetaBySession[session.id]?.isSim || false,
        sim_run_id: simMetaBySession[session.id]?.simRunId || null,
      })));
    } finally {
      setSessionsLoading(false);
    }
  };

  const loadSessionDetail = async (sessionId, force = false) => {
    if (
      !force &&
      detailsBySession[sessionId]?.messages !== undefined &&
      detailsBySession[sessionId]?.thinkingEvents !== undefined
    ) {
      return detailsBySession[sessionId];
    }

    setDetailsBySession((prev) => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] || {}), loading: true },
    }));

    const [{ data: messages }, { data: thinkingEvents }] = await Promise.all([
      supabase
        .from('reflection_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }),
      supabase
        .from('session_thinking_events')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }),
    ]);

    const detail = {
      loading: false,
      messages: messages || [],
      thinkingEvents: thinkingEvents || [],
    };

    setDetailsBySession((prev) => ({ ...prev, [sessionId]: detail }));
    return detail;
  };

  useEffect(() => {
    if (isAdmin) loadSessions();
  }, [isAdmin]);

  const filteredSessions = useMemo(() => sessions.filter((session) => {
    if (selectedFilter === 'sim') return session.is_sim;
    if (selectedFilter === 'real') return !session.is_sim;
    return true;
  }), [sessions, selectedFilter]);

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <AppShellV2 title="Session Log">
      <div className="h-full overflow-y-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <ScrollText className="w-5 h-5 text-red-500" />
          <h2 className="text-white font-semibold text-lg">Session Log</h2>
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-900/40 border border-red-800 text-red-400">DEV</span>
          <button
            onClick={async () => {
              await loadSessions();
              if (expandedSessionId) {
                await loadSessionDetail(expandedSessionId, true);
              }
            }}
            className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-zinc-400 text-sm">{filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}</p>
          <div className="flex items-center gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setSelectedFilter(filter.value)}
                className={`px-3 py-1.5 rounded-xl border text-sm transition-colors ${
                  selectedFilter === filter.value
                    ? 'bg-red-900/40 border-red-800 text-red-300'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {sessionsLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
          </div>
        )}

        {!sessionsLoading && filteredSessions.length === 0 && (
          <p className="text-zinc-500 text-sm">No reflection sessions found.</p>
        )}

        {!sessionsLoading && filteredSessions.map((session) => {
          const isExpanded = expandedSessionId === session.id;
          const detail = detailsBySession[session.id];
          const activeTab = tabsBySession[session.id] || 'transcript';

          return (
            <div key={session.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <p className="text-zinc-400 text-xs">{formatDateTime(session.created_at || session.updated_at || session.date)}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span title={session.user_id || ''}>User: {session.user_id?.slice(0, 8)}…</span>
                    <span className="px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300">Stage: {session.current_stage || '—'}</span>
                    <span className="px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300">Turns: {session.turn_count || 0}</span>
                    {session.is_sim && (
                      <span className="px-2 py-0.5 rounded border border-amber-800 bg-amber-900/30 text-amber-300">SIM</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(session.exercises_run || []).length > 0 ? (
                      session.exercises_run.map((exerciseId) => (
                        <span key={exerciseId} className="px-2 py-0.5 rounded-full text-xs bg-zinc-800 border border-zinc-700 text-zinc-300">
                          {exerciseId}
                        </span>
                      ))
                    ) : (
                      <span className="text-zinc-600 text-xs">No exercises run</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={async () => {
                    if (isExpanded) {
                      setExpandedSessionId(null);
                      return;
                    }
                    setExpandedSessionId(session.id);
                    setTabsBySession((prev) => ({ ...prev, [session.id]: prev[session.id] || 'transcript' }));
                    await loadSessionDetail(session.id);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors flex-shrink-0"
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {isExpanded ? 'Hide' : 'View'}
                </button>
              </div>

              {isExpanded && (
                <div className="border-t border-zinc-800 pt-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setTabsBySession((prev) => ({ ...prev, [session.id]: 'transcript' }))}
                        className={`px-3 py-1.5 rounded-xl border text-sm transition-colors ${
                          activeTab === 'transcript'
                            ? 'bg-red-900/40 border-red-800 text-red-300'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        }`}
                      >
                        Chat Transcript
                      </button>
                      <button
                        onClick={() => setTabsBySession((prev) => ({ ...prev, [session.id]: 'timeline' }))}
                        className={`px-3 py-1.5 rounded-xl border text-sm transition-colors ${
                          activeTab === 'timeline'
                            ? 'bg-red-900/40 border-red-800 text-red-300'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        }`}
                      >
                        Thinking Timeline
                      </button>
                    </div>

                    <button
                      onClick={async () => {
                        const loadedDetail = await loadSessionDetail(session.id);
                        downloadSessionJson(session, loadedDetail);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {detail?.loading && (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
                    </div>
                  )}

                  {!detail?.loading && activeTab === 'transcript' && (
                    <div className="space-y-3">
                      {(detail?.messages || []).length === 0 && (
                        <p className="text-zinc-500 text-sm">No messages saved for this session.</p>
                      )}
                      {(detail?.messages || []).map((message) => {
                        const isUser = message.role === 'user';
                        const hasReasoning = !isUser && message.ai_reasoning;
                        return (
                          <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 border ${isUser ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-zinc-800/90 border-red-900/40 text-zinc-100'}`}>
                              <p className="text-[11px] uppercase tracking-wide mb-2 text-zinc-400">{message.role}</p>
                              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                              {hasReasoning && (
                                <details className="mt-3 rounded-xl border border-zinc-700 bg-zinc-950/50 px-3 py-2">
                                  <summary className="cursor-pointer text-xs text-zinc-300 flex items-center gap-2 list-none">
                                    <span className="inline-flex items-center gap-1"><Brain className="w-3.5 h-3.5" /> thinking</span>
                                  </summary>
                                  <div className="mt-3 space-y-2 text-sm text-zinc-300">
                                    <p><span className="text-zinc-400">Why this question:</span> {message.ai_reasoning?.why_this_question || '—'}</p>
                                    <p><span className="text-zinc-400">Emotional read:</span> {message.ai_reasoning?.emotional_read || '—'}</p>
                                    <p><span className="text-zinc-400">Strategic intent:</span> {message.ai_reasoning?.strategic_intent || '—'}</p>
                                  </div>
                                </details>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!detail?.loading && activeTab === 'timeline' && (
                    <div className="space-y-4">
                      {(detail?.thinkingEvents || []).length === 0 && (
                        <p className="text-zinc-500 text-sm">No thinking events logged for this session.</p>
                      )}
                      {(detail?.thinkingEvents || []).map((event) => (
                        <div key={event.id} className="relative pl-6">
                          <div className="absolute left-2 top-0 bottom-0 w-px bg-zinc-800" />
                          <div className="absolute left-[5px] top-4 w-2.5 h-2.5 rounded-full bg-red-500" />
                          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 space-y-2">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${EVENT_TYPE_STYLES[event.event_type] || EVENT_TYPE_STYLES.directive_dispatch}`}>
                                {event.event_type}
                              </span>
                              <span className="text-zinc-500 text-xs">Turn {event.turn_index ?? '—'} • {formatDateTime(event.created_at)}</span>
                            </div>
                            {renderThinkingEvent(event)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShellV2>
  );
}
