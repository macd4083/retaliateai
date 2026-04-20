import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Moon, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';
import { localDateStr } from '../lib/dateUtils';
import AppShellV2 from '../components/v2/AppShellV2';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimeContext() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return { period: 'morning', greeting: 'Good morning' };
  if (hour >= 12 && hour < 18) return { period: 'afternoon', greeting: 'Good afternoon' };
  if (hour >= 18 && hour < 23) return { period: 'evening', greeting: 'Good evening' };
  if (hour >= 23 || hour < 2) return { period: 'late_night', greeting: 'Still up?' };
  if (hour >= 2 && hour < 6) return { period: 'early_morning', greeting: "Can't sleep?" };
  return { period: 'late', greeting: 'Hey' };
}

const BASE_STAGES = [
  { id: 'wins', label: 'Wins' },
  { id: 'commitment_checkin', label: 'Check-in' },
  { id: 'honest', label: 'Honest' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'close', label: 'Close' },
];

const STAGE_PLACEHOLDERS = {
  wins: 'How are you feeling tonight?',
  commitment_checkin: 'How did it go?',
  honest: 'Tell me more...',
  tomorrow: 'What will you commit to?',
  close: 'Write yourself a message...',
};

const DEFAULT_CHECKLIST = { wins: false, commitment_checkin: false, honest: false, plan: false, identity: false };

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ currentStage, stages }) {
  const stageIndex = stages.findIndex((s) => s.id === currentStage);
  return (
    <div className="flex items-center justify-center gap-3 py-3">
      {stages.map((stage, i) => {
        const isComplete = i < stageIndex;
        const isActive = i === stageIndex;
        return (
          <div key={stage.id} className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`rounded-full transition-all duration-200 ${
                  isActive
                    ? 'w-3 h-3 bg-red-500'
                    : isComplete
                    ? 'w-2 h-2 bg-red-700'
                    : 'w-2 h-2 bg-zinc-600'
                }`}
              />
              <span
                className={`text-xs font-medium transition-opacity duration-200 ${
                  isActive ? 'text-red-400 opacity-100' : 'opacity-0 select-none'
                }`}
              >
                {stage.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className={`w-8 h-px mb-4 ${i < stageIndex ? 'bg-red-700' : 'bg-zinc-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-8 h-8 rounded-full bg-red-900 border border-red-700 flex items-center justify-center flex-shrink-0 mt-1">
        <Moon className="w-4 h-4 text-red-400" />
      </div>
      <div className="bg-zinc-800 border border-zinc-700 rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-5">
          <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ data, streak, followThroughStats }) {
  const navigate = useNavigate();

  // Derive follow-through summary line (only shown if total >= 3)
  let followThroughLine = null;
  let followThroughEmoji = null;
  if (followThroughStats && followThroughStats.total >= 3) {
    const { kept, total, trajectory } = followThroughStats;
    const rate = kept / total;
    if (rate >= 0.7) {
      followThroughLine = `You've kept ${kept} of your last ${total} commitments. That's your highest stretch yet.`;
      followThroughEmoji = '✅';
    } else if (trajectory === 'improving') {
      followThroughLine = `${kept} of ${total} this week. You're trending up — keep it going.`;
      followThroughEmoji = '📈';
    } else if (rate >= 0.4) {
      followThroughLine = `${kept} of ${total} this week. You're in a building phase — that's real.`;
      followThroughEmoji = '📈';
    } else {
      followThroughLine = `${kept} of ${total} this week. Let's make the next one smaller and easier to nail.`;
      followThroughEmoji = '🎯';
    }
  }

  return (
    <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-5 my-2 shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎯</span>
        <span className="text-white font-semibold">Tonight's Takeaways</span>
      </div>
      <div className="border-t border-zinc-600 pt-4 space-y-3">
        {data.win_text && (
          <div className="flex items-start gap-2">
            <span className="text-green-400 mt-0.5">✅</span>
            <div>
              <span className="text-zinc-400 text-xs">Win</span>
              <p className="text-white text-sm">{data.win_text}</p>
            </div>
          </div>
        )}
        {data.miss_text && (
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 mt-0.5">💡</span>
            <div>
              <span className="text-zinc-400 text-xs">Honest truth</span>
              <p className="text-white text-sm">{data.miss_text}</p>
            </div>
          </div>
        )}
        {data.tomorrow_commitment && (
          <>
            {!data.commitment_minimum && !data.commitment_stretch && (
              <div className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">📋</span>
                <div>
                  <span className="text-zinc-400 text-xs">Tomorrow</span>
                  <p className="text-white text-sm">{data.tomorrow_commitment}</p>
                </div>
              </div>
            )}
          </>
        )}
        {data.commitment_minimum && (
          <div className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">🎯</span>
            <div>
              <span className="text-zinc-400 text-xs">Minimum</span>
              <p className="text-white text-sm">{data.commitment_minimum}</p>
            </div>
          </div>
        )}
        {data.commitment_stretch && (
          <div className="flex items-start gap-2">
            <span className="text-purple-400 mt-0.5">🚀</span>
            <div>
              <span className="text-zinc-400 text-xs">Stretch</span>
              <p className="text-white text-sm">{data.commitment_stretch}</p>
            </div>
          </div>
        )}
        {streak > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-red-400">🔥</span>
            <p className="text-white text-sm font-medium">
              {streak} night{streak !== 1 ? 's' : ''} in a row
            </p>
          </div>
        )}
        {followThroughStats && followThroughStats.total >= 3 && followThroughLine && (
          <div className="flex items-center gap-2">
            <span>{followThroughEmoji}</span>
            <p className="text-white text-sm">{followThroughLine}</p>
          </div>
        )}
        {data.self_hype_message && (
          <div className="mt-4 p-3 bg-zinc-900 rounded-xl border border-zinc-700">
            <p className="text-zinc-300 text-sm italic">"{data.self_hype_message}"</p>
          </div>
        )}
      </div>
      <p className="text-zinc-500 text-xs mt-4 text-center italic">
        You're building the identity of someone who shows up.
      </p>
      <div className="flex sm:justify-end justify-center mt-3">
        <button
          onClick={() => navigate('/insights')}
          className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
        >
          → View Insights
        </button>
      </div>
    </div>
  );
}


function ChatMessage({ message, isFirstMessage, onChipSelect, chipsDisabled, streak, followThroughStats }) {
  const isUser = message.role === 'user';
  if (message.isTyping) return <TypingIndicator />;
  if (message.message_type === 'summary_card' && message.card_data) {
    return (
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-red-900 border border-red-700 flex items-center justify-center flex-shrink-0 mt-1">
          <Moon className="w-4 h-4 text-red-400" />
        </div>
        <div className="max-w-[80%]">
          <SummaryCard data={message.card_data} streak={streak} followThroughStats={followThroughStats} />
        </div>
      </div>
    );
  }
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'items-start gap-3'} mb-4`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-red-900 border border-red-700 flex items-center justify-center flex-shrink-0 mt-1">
          <Moon className="w-4 h-4 text-red-400" />
        </div>
      )}
      <div className="max-w-[75%]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-red-600 text-white rounded-tr-sm'
              : 'bg-zinc-800 border border-zinc-700 text-white rounded-tl-sm'
          }`}
        >
          {message.content}
        </motion.div>
        {!isUser && message.chips && message.chips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.chips.map((chip) => (
              <button
                key={chip.value}
                onClick={() => !chipsDisabled && onChipSelect(chip)}
                disabled={chipsDisabled}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  chipsDisabled
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-600 cursor-not-allowed'
                    : 'bg-zinc-800 border-zinc-600 text-zinc-200 hover:bg-red-900 hover:border-red-700 hover:text-white cursor-pointer'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReflectionV2() {
  const { user } = useAuth();
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Guard ref — initSession only ever runs once per mount
  const initCalledRef = useRef(false);
  const initSentRef = useRef(false);

  // messagesRef always holds the latest messages array so sendMessage
  // never closes over a stale snapshot.
  const messagesRef = useRef([]);
  const commitmentStatsCacheRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [isComplete, setIsComplete] = useState(false);
  const [usedChipMessageIds, setUsedChipMessageIds] = useState(new Set());
  const [streak, setStreak] = useState(0);
  const [userProfile, setUserProfile] = useState(null);
  const [sessionState, setSessionState] = useState({
    current_stage: 'wins',
    mood_end_of_day: null,
    steps_completed: [],
    wins: [],
    misses: [],
    blocker_tags: [],
    tomorrow_commitment: null,
    commitment_minimum: null,
    commitment_stretch: null,
    self_hype_message: null,
    consecutive_excuses: 0,
    checklist: { ...DEFAULT_CHECKLIST },
    exercises_run: [],
    wins_asked_for_more: false,
    honest_depth: false,
    yesterday_commitment: null,
    commitment_checkin_done: false,
    checkin_outcome: null,
    commitment_score: null,
    checklist_fragments: [],
    fragments_submitted: false,
    depth_opportunity_count: 0,
    directive_queue: [],
    completed_directives: [],
  });
  const [summaryCardData, setSummaryCardData] = useState({});
  const [followThroughStats, setFollowThroughStats] = useState(null);
  const [commitmentStatsCache, setCommitmentStatsCache] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingGoalSuggestion, setPendingGoalSuggestion] = useState(null);
  const [pendingWhyCapture, setPendingWhyCapture] = useState(null); // { goalId, title }
  const [activeGoals, setActiveGoals] = useState([]);
  const [showGoalChips, setShowGoalChips] = useState(false);
  const [selectedGoalChips, setSelectedGoalChips] = useState([]);
  const [checkedFragments, setCheckedFragments] = useState({});
  const [chatFocused, setChatFocused] = useState(false);

  const timeContext = getTimeContext();

  const stages = sessionState.yesterday_commitment
    ? BASE_STAGES
    : BASE_STAGES.filter((s) => s.id !== 'commitment_checkin');

  // Keep messagesRef in sync with messages state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ── Admin check ───────────────────────────────────────────────────────────

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

  // ── Scroll to bottom ──────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Initialize session ──────────────────────────────���─────────────────────

  useEffect(() => {
    if (!user?.id) return;
    if (initCalledRef.current) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      initCalledRef.current = true;
      initSession();
    }).catch((err) => {
      console.error('[initSession] session check failed:', err);
    });
  }, [user?.id]);

  async function initSession() {
    setIsInitializing(true);
    setInitError(false);
    try {
      // Profile load — non-critical, fail silently
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('display_name, full_name, identity_statement, big_goal, why, future_self, life_areas, blockers')
          .eq('id', user.id)
          .maybeSingle();
        setUserProfile(profile);
      } catch (profileErr) {
        console.error('[initSession] profile load failed:', profileErr);
      }

      // Session creation — critical
      let session;
      try {
        session = await reflectionHelpers.getTodaySession(user.id);
      } catch (sessionErr) {
        console.error('[initSession] getTodaySession failed:', sessionErr);
        throw sessionErr;
      }
      setSessionId(session.id);
      setIsComplete(session.is_complete);

      // Fetch yesterday's commitment — non-critical, fail silently
      let fetchedYesterdayCommitment = null;
      try {
        fetchedYesterdayCommitment = await reflectionHelpers.getYesterdayCommitment(user.id);
      } catch (_e) {}

      const restoredState = {
        current_stage: session.current_stage || 'wins',
        mood_end_of_day: session.mood_end_of_day || null,
        steps_completed: [],
        wins: session.wins || [],
        misses: session.misses || [],
        blocker_tags: session.blocker_tags || [],
        tomorrow_commitment: session.tomorrow_commitment || null,
        commitment_minimum: session.commitment_minimum || null,
        commitment_stretch: session.commitment_stretch || null,
        self_hype_message: session.self_hype_message || null,
        consecutive_excuses: session.consecutive_excuses || 0,
        checklist: session.checklist || { ...DEFAULT_CHECKLIST },
        exercises_run: Array.isArray(session.exercises_run) ? session.exercises_run : [],
        wins_asked_for_more: false,
        honest_depth: false,
        yesterday_commitment: session.yesterday_commitment || fetchedYesterdayCommitment || null,
        commitment_checkin_done: session.commitment_checkin_done === true,
        checkin_outcome: session.checkin_outcome || null,
        commitment_score: session.commitment_score ?? null,
        checklist_fragments: [],
        fragments_submitted: !!(session.commitment_checkin_done && session.commitment_score != null),
        depth_opportunity_count: session.depth_opportunity_count || 0,
        directive_queue: Array.isArray(session.directive_queue) ? session.directive_queue : [],
        completed_directives: Array.isArray(session.completed_directives) ? session.completed_directives : [],
      };
      setSessionState(restoredState);

      // Streak — non-critical, fail silently
      try {
        const currentStreak = await reflectionHelpers.getReflectionStreak(user.id);
        setStreak(currentStreak);
      } catch (streakErr) {
        console.error('[initSession] getReflectionStreak failed:', streakErr);
      }

      try {
        const statsRes = await fetch('/api/commitment-stats', {
          method: 'POST',
          headers: await getAuthHeaders(),
          body: JSON.stringify({ user_id: user.id, client_local_date: localDateStr() }),
        });
        if (statsRes.ok) {
          const stats = await statsRes.json();
          setCommitmentStatsCache(stats);
          commitmentStatsCacheRef.current = stats;
        }
      } catch (_e) {}

      // Active goals — non-critical, fail silently
      try {
        const { data: goalsData } = await supabase
          .from('goals')
          .select('id, title, category')
          .eq('user_id', user.id)
          .eq('status', 'active');
        setActiveGoals(goalsData || []);
      } catch (_e) {}

      // Message load — critical
      let existingMessages;
      try {
        existingMessages = await reflectionHelpers.getSessionMessages(session.id);
      } catch (msgErr) {
        console.error('[initSession] getSessionMessages failed:', msgErr);
        throw msgErr;
      }

      if (existingMessages.length > 0) {
        // Deduplicate messages loaded from DB by content+role
        const seen = new Set();
        const deduped = existingMessages.filter((m) => {
          const key = `${m.role}::${m.content}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const restored = deduped.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          chips: m.chips || null,
          message_type: m.message_type || null,
          card_data: m.extracted_data?.card_data || null,
          isTyping: false,
        }));
        messagesRef.current = restored;
        setMessages(restored);

        const usedIds = new Set(
          deduped
            .filter((m, i) =>
              m.role === 'assistant' &&
              m.chips &&
              deduped.slice(i + 1).some((n) => n.role === 'user')
            )
            .map((m) => m.id)
        );
        setUsedChipMessageIds(usedIds);
        // Only skip hero if there are actual conversation messages beyond the opener
        if (deduped.length > 1) {
          setChatFocused(true);
        }
      } else {
        if (!initSentRef.current) {
          initSentRef.current = true;
          try {
            await sendMessage('__INIT__', session.id, restoredState);
          } catch (initMsgErr) {
            console.error('[initSession] sendMessage __INIT__ failed:', initMsgErr);
            messagesRef.current = [];
            setMessages([]);
            throw initMsgErr;
          }
        }
      }
    } catch (error) {
      console.error('[initSession] Fatal error loading session:', error);
      const errMsg = [{
        id: Date.now(),
        role: 'assistant',
        content: "Couldn't load your session. Please refresh and try again.",
        chips: null,
        message_type: 'question',
        isTyping: false,
      }];
      messagesRef.current = errMsg;
      setMessages(errMsg);
      setInitError(true);
    } finally {
      setIsInitializing(false);
    }
  }

  // ── Build history for API ─────────────────────────────────────────────────

  function buildHistory(msgs) {
    return msgs
      .filter((m) => !m.isTyping && m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
  }

  // ── Auth header helper ────────────────────────────────────────────────────

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async function sendMessage(userText, overrideSessionId, overrideState, extraContext = {}) {
    const sid = overrideSessionId || sessionId;
    const state = overrideState || sessionState;
    if (!sid || !user?.id) return;

    const isInit = userText === '__INIT__';
    const isChecklistSubmission = userText === '__CHECKLIST_SUBMITTED__';

    let currentMsgs = messagesRef.current;

    if (!isInit && !isChecklistSubmission) {
      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userText,
        chips: null,
        message_type: null,
        isTyping: false,
      };
      currentMsgs = [...currentMsgs, userMsg];
      messagesRef.current = currentMsgs;
      setMessages(currentMsgs);

      reflectionHelpers
        .saveMessage(sid, user.id, {
          role: 'user',
          content: userText,
          stage: state.current_stage,
        })
        .catch(() => {});

      // If we're capturing a why for a newly accepted goal, save this message as the why
      if (pendingWhyCapture) {
        const { goalId } = pendingWhyCapture;
        setPendingWhyCapture(null);
        // Read current whys and append (safe even if already empty on a new goal)
        supabase
          .from('goals')
          .select('whys')
          .eq('id', goalId)
          .eq('user_id', user.id)
          .maybeSingle()
          .then(({ data: gd }) => {
            const current = Array.isArray(gd?.whys) ? gd.whys : [];
            const newEntry = { text: userText, added_at: new Date().toISOString(), source: 'user_journal' };
            return supabase
              .from('goals')
              .update({ whys: [...current, newEntry] })
              .eq('id', goalId)
              .eq('user_id', user.id);
          })
          .catch(() => {});
      }
    }

    // Add typing indicator
    const withTyping = [...currentMsgs, { id: `typing-${Date.now()}`, role: 'assistant', isTyping: true }];
    messagesRef.current = withTyping;
    setMessages(withTyping);
    setIsLoading(true);

    try {
      let yesterdayCommitment = null;
      try {
        yesterdayCommitment = await reflectionHelpers.getYesterdayCommitment(user.id);
      } catch (_e) {}

      let profile = userProfile;
      if (!profile) {
        try {
          const { data } = await supabase
            .from('user_profiles')
            .select('display_name, full_name, identity_statement, big_goal, why, future_self, life_areas, blockers')
            .eq('id', user.id)
            .maybeSingle();
          profile = data;
          setUserProfile(data);
        } catch (_e) {}
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const commitmentStats = commitmentStatsCacheRef.current || commitmentStatsCache;

      let response;
      try {
        response = await fetch('/api/reflection-coach', {
          method: 'POST',
          headers: await getAuthHeaders(),
          signal: controller.signal,
          body: JSON.stringify({
            user_id: user.id,
            session_id: sid,
            session_state: {
              ...state,
              is_first_message: isInit,
              yesterday_commitment: state.yesterday_commitment,
              commitment_checkin_done: state.commitment_checkin_done,
              checkin_outcome: state.checkin_outcome,
              commitment_score: state.commitment_score,
              depth_opportunity_count: state.depth_opportunity_count || 0,
              yesterday_commitment_in_state: !!state.yesterday_commitment,
              consecutive_excuses: state.consecutive_excuses || 0,
              checklist: state.checklist || { ...DEFAULT_CHECKLIST },
            },
            history: isInit ? [] : buildHistory(currentMsgs),
            user_message: userText,
            context: {
              streak,
              time_of_day: timeContext.greeting,
              yesterday_commitment: yesterdayCommitment,
              identity_statement: profile?.identity_statement || null,
              big_goal: profile?.big_goal || null,
              why: profile?.why || null,
              future_self: profile?.future_self || null,
              life_areas: profile?.life_areas || [],
              blockers: profile?.blockers || [],
              display_name: profile?.display_name || profile?.full_name || null,
              client_local_date: localDateStr(),
              client_tz_offset: new Date().getTimezoneOffset(),
              commitment_rate_7: commitmentStats?.followThrough7?.total >= 3
                ? Math.round((commitmentStats.followThrough7.kept / commitmentStats.followThrough7.total) * 100)
                : null,
              commitment_trajectory: commitmentStats?.trajectory ?? null,
              avg_commitment_score: commitmentStats?.avgScore7 ?? null,
              score_trajectory: commitmentStats?.scoreTrajectory ?? null,
              ...extraContext,
            },
          }),
        });
      } catch (fetchErr) {
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response || !response.ok) throw new Error('API error');

      const data = await response.json();

      // Client-side guard: if assistant_message is a raw JSON string, unwrap and merge fields
      if (data.assistant_message && typeof data.assistant_message === 'string' && data.assistant_message.trimStart().startsWith('{')) {
        try {
          const inner = JSON.parse(data.assistant_message);
          if (inner && typeof inner.assistant_message === 'string') {
            Object.assign(data, inner);
          }
        } catch (_e) { /* not JSON — leave as-is */ }
      }

      const isSessionComplete = !!data.is_session_complete;
      const isSummaryCard = isSessionComplete || data.new_stage === 'complete';

      let newSummaryData = summaryCardData;
      if (data.extracted_data) {
        newSummaryData = { ...summaryCardData, ...data.extracted_data };
        setSummaryCardData(newSummaryData);
      }

      const shouldShowChecklist =
        data.show_commitment_checklist === true &&
        Array.isArray(data.checklist_fragments) &&
        data.checklist_fragments.length > 0;
      const aiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.assistant_message || '',
        chips: data.chips || null,
        message_type: isSummaryCard
          ? 'summary_card'
          : data.message_type || 'question',
        card_data: isSummaryCard ? newSummaryData : null,
        isTyping: false,
      };

      // Build final list — strip typing indicator, append AI reply
      const finalMsgs = [...messagesRef.current.filter((m) => !m.isTyping), aiMessage];
      messagesRef.current = finalMsgs;
      setMessages(finalMsgs);

      // ── FIX: Save assistant message to DB so it persists on refresh ──
      reflectionHelpers
        .saveMessage(sid, user.id, {
          role: 'assistant',
          content: data.assistant_message || '',
          stage: state.current_stage,
          message_type: isSummaryCard ? 'summary_card' : data.message_type || 'question',
          chips: data.chips || null,
          extracted_data: isSummaryCard ? { card_data: newSummaryData } : null,
        })
        .catch(() => {});

      if (data.extracted_data || data.stage_advance || data.checklist_updates || data.consecutive_excuses !== undefined || data.wins_asked_for_more || data.honest_depth || data.commitment_checkin_done || shouldShowChecklist) {
        const newState = { ...state };
        if (data.extracted_data?.mood) newState.mood_end_of_day = data.extracted_data.mood;
        if (data.extracted_data?.win_text)
          newState.wins = [...(newState.wins || []), { text: data.extracted_data.win_text }];
        if (data.extracted_data?.miss_text)
          newState.misses = [...(newState.misses || []), { text: data.extracted_data.miss_text }];
        if (data.extracted_data?.blocker_tags)
          newState.blocker_tags = [...new Set([...(newState.blocker_tags || []), ...data.extracted_data.blocker_tags])];
        if (data.extracted_data?.tomorrow_commitment)
          newState.tomorrow_commitment = data.extracted_data.tomorrow_commitment;
        if (data.extracted_data?.commitment_minimum)
          newState.commitment_minimum = data.extracted_data.commitment_minimum;
        if (data.extracted_data?.commitment_stretch)
          newState.commitment_stretch = data.extracted_data.commitment_stretch;
        if (data.extracted_data?.self_hype_message)
          newState.self_hype_message = data.extracted_data.self_hype_message;
        if (data.extracted_data?.depth_insight)
          newState.depth_insight = data.extracted_data.depth_insight;
        if (data.stage_advance && data.new_stage)
          newState.current_stage = data.new_stage;
        if (data.checklist_updates) {
          newState.checklist = { ...(newState.checklist || { ...DEFAULT_CHECKLIST }) };
          Object.keys(data.checklist_updates).forEach((key) => {
            if (data.checklist_updates[key]) newState.checklist[key] = true;
          });
        }
        if (data.exercise_run && data.exercise_run !== 'none') {
          newState.exercises_run = [...new Set([...(newState.exercises_run || []), data.exercise_run])];
        }
        if (data.consecutive_excuses !== undefined) {
          newState.consecutive_excuses = data.consecutive_excuses;
        }
        if (data.wins_asked_for_more === true) newState.wins_asked_for_more = true;
        if (data.honest_depth === true) newState.honest_depth = true;
        if (data.commitment_checkin_done === true) newState.commitment_checkin_done = true;
        if (data.checkin_outcome) newState.checkin_outcome = data.checkin_outcome;
        if (data.extracted_data?.commitment_score != null)
          newState.commitment_score = data.extracted_data.commitment_score;
        if (shouldShowChecklist) {
          newState.checklist_fragments = data.checklist_fragments.map((f) => ({
            id: f.id,
            text: f.text || f.commitment_text || '',
          }));
          newState.fragments_submitted = false;
          setCheckedFragments({});
        }
        if (data.commitment_checkin_done === true) {
          newState.checklist_fragments = [];
          newState.fragments_submitted = true;
          setCheckedFragments({});
        }
        if (data.depth_opportunity === true || data.intentData?.depth_opportunity === true) {
          newState.depth_opportunity_count = (newState.depth_opportunity_count || 0) + 1;
        }
        if (data.extracted_data?.yesterday_commitment && !newState.yesterday_commitment) {
          newState.yesterday_commitment = data.extracted_data.yesterday_commitment;
        }
        newState.directive_queue = data.directive_queue || [];
        newState.completed_directives = data.completed_directives || [];
        setSessionState(newState);

        const dbUpdates = {};
        if (data.extracted_data?.mood) dbUpdates.mood_end_of_day = data.extracted_data.mood;
        if (data.extracted_data?.tomorrow_commitment) {
          dbUpdates.tomorrow_commitment = data.extracted_data.tomorrow_commitment;
          // Set commitment_made_at when saving for the first time
          if (!state.tomorrow_commitment) {
            dbUpdates.commitment_made_at = new Date().toISOString();
          }
        }
        if (data.extracted_data?.commitment_minimum && !state.commitment_minimum)
          dbUpdates.commitment_minimum = data.extracted_data.commitment_minimum;
        if (data.extracted_data?.commitment_stretch && !state.commitment_stretch)
          dbUpdates.commitment_stretch = data.extracted_data.commitment_stretch;
        if (data.extracted_data?.commitment_score != null)
          dbUpdates.commitment_score = data.extracted_data.commitment_score;
        if (data.extracted_data?.self_hype_message)
          dbUpdates.self_hype_message = data.extracted_data.self_hype_message;
        if (data.stage_advance && data.new_stage) dbUpdates.current_stage = data.new_stage;
        if (data.commitment_checkin_done === true && !state.commitment_checkin_done) {
          dbUpdates.commitment_checkin_done = true;
        }
        if (data.checkin_outcome && !state.checkin_outcome) {
          dbUpdates.checkin_outcome = data.checkin_outcome;
        }
        if (Object.keys(dbUpdates).length > 0)
          reflectionHelpers.updateSession(sid, dbUpdates).catch(() => {});
      }

      // Handle new goal suggestion from coach
      if (data.goal_suggestion_pending?.action === 'new_goal' && data.goal_suggestion_pending?.title) {
        setPendingGoalSuggestion(data.goal_suggestion_pending);
      }

      // Show goal chips composer when coach asks the tomorrow commitment question
      if (data.show_goal_chips === true) {
        setShowGoalChips(true);
        setSelectedGoalChips([]);
      }

      if (isSessionComplete) {
        setIsComplete(true);
        reflectionHelpers.updateSession(sid, {
          is_complete: true,
          current_stage: 'complete',
          completed_at: new Date().toISOString(),
        }).then(() => {
          // Session is now marked is_complete = true in the DB, so
          // getReflectionStreak will include today's session in its count.
          return reflectionHelpers.getReflectionStreak(user.id);
        }).then((accurateStreak) => {
          setStreak(accurateStreak);
          return reflectionHelpers.updateSession(sid, { reflection_streak: accurateStreak });
        }).catch(() => {});

        // Fetch follow-through stats to show in the summary card
        try {
          const statsRes = await fetch('/api/commitment-stats', {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: JSON.stringify({ user_id: user.id }),
          });
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            setFollowThroughStats({
              kept: statsData.followThrough7?.kept ?? 0,
              total: statsData.followThrough7?.total ?? 0,
              trajectory: statsData.trajectory,
            });
          }
        } catch (_e) {}

        const alreadyHasPrompt = messagesRef.current.some((m) => m.id === 'post-session-prompt');
        if (!alreadyHasPrompt) {
          const postSessionMsg = {
            id: 'post-session-prompt',
            role: 'assistant',
            content: "That's a wrap on tonight. 🌙 Anything else on your mind before you close out?",
            chips: null,
            isPostSession: true,
            isTyping: false,
          };
          const withPrompt = [...messagesRef.current, postSessionMsg];
          messagesRef.current = withPrompt;
          setMessages(withPrompt);
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      const isTimeout = error.name === 'AbortError';
      const errMsg = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: isTimeout
          ? "That took too long on my end. Try sending that again — I'm here."
          : 'Something went wrong. Try sending that again.',
        chips: null,
        message_type: 'question',
        isTyping: false,
      };
      const withErr = [...messagesRef.current.filter((m) => !m.isTyping), errMsg];
      messagesRef.current = withErr;
      setMessages(withErr);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Admin reset ───────────────────────────────────────────────────────────

  async function handleAdminReset() {
    if (!confirm("Reset today's session? This deletes it from the database and reinitializes.")) return;
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          action: 'reset',
          user_id: user.id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        messagesRef.current = [];
        setMessages([]);
        setSessionId(null);
        setIsComplete(false);
        setSummaryCardData({});
        setUsedChipMessageIds(new Set());
        setCommitmentStatsCache(null);
        commitmentStatsCacheRef.current = null;
        setSessionState({
          current_stage: 'wins',
          mood_end_of_day: null,
          steps_completed: [],
          wins: [],
          misses: [],
          blocker_tags: [],
          tomorrow_commitment: null,
          commitment_minimum: null,
          commitment_stretch: null,
          self_hype_message: null,
          consecutive_excuses: 0,
          checklist: { ...DEFAULT_CHECKLIST },
          exercises_run: [],
          wins_asked_for_more: false,
          honest_depth: false,
          yesterday_commitment: null,
          commitment_checkin_done: false,
          checkin_outcome: null,
          commitment_score: null,
          checklist_fragments: [],
          fragments_submitted: false,
          depth_opportunity_count: 0,
          directive_queue: [],
          completed_directives: [],
        });
        initCalledRef.current = false;
        initSentRef.current = false;
        setIsInitializing(true);
        initSession();
      }
    } catch (err) {
      console.error('[handleAdminReset] failed:', err);
    }
  }

  // ── Handle goal suggestion acceptance ────────────────────────────────────

  async function handleAcceptGoalSuggestion() {
    if (!pendingGoalSuggestion) return;
    const { title, category } = pendingGoalSuggestion;
    setPendingGoalSuggestion(null);
    try {
      const res = await fetch('/api/create-goal', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ user_id: user.id, title, category: category || null }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newGoalId = data.goal?.id;

      // Inject coach message asking for why
      const whyMsg = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: `Nice — what makes "${title}" actually matter to you? Not the goal itself, but what's underneath it?`,
        chips: null,
        message_type: 'question',
        card_data: null,
        isTyping: false,
      };
      const withWhy = [...messagesRef.current, whyMsg];
      messagesRef.current = withWhy;
      setMessages(withWhy);

      if (newGoalId) {
        setPendingWhyCapture({ goalId: newGoalId, title });
      }
    } catch (_e) {}
  }

  // ── Handle chip selection ─────────────────────────────────────────────────

  function handleChipSelect(chip, messageId) {
    if (isLoading) return;
    setChatFocused(true);
    setUsedChipMessageIds((prev) => new Set([...prev, messageId]));
    sendMessage(chip.label);
  }

  async function handleChecklistSubmit() {
    const fragments = sessionState.checklist_fragments;
    const fragmentResults = fragments.map((f) => ({ id: f.id, kept: !!checkedFragments[f.id] }));

    try {
      await fetch('/api/evaluate-goal-commitments', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          user_id: user.id,
          session_date: sessionState.date || localDateStr(),
          fragment_results: fragmentResults,
        }),
      });
    } catch (_e) {}

    setCheckedFragments({});
    setSessionState((prev) => ({ ...prev, fragments_submitted: true }));
    await sendMessage('__CHECKLIST_SUBMITTED__', undefined, undefined, {
      checklist_result: fragmentResults,
    });
  }

  // ── Handle send ───────────────────────────────────────────────────────────

  function handleSend() {
    const text = inputValue.trim();
    const hasNoContent = !text && selectedGoalChips.length === 0;
    if (hasNoContent || isLoading) return;
    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    let fullMessage = text;
    if (showGoalChips && selectedGoalChips.length > 0) {
      const chipText = selectedGoalChips.join(' + ');
      if (chipText && text) {
        fullMessage = `${chipText}. ${text}`;
      } else {
        fullMessage = chipText || text;
      }
    }

    setShowGoalChips(false);
    setSelectedGoalChips([]);

    sendMessage(fullMessage);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleTextareaChange(e) {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  useEffect(() => {
    if (!isInitializing && chatFocused && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isInitializing, chatFocused]);

  // ── Render ───────────────────────────
  const isChecklistBlocking =
    sessionState.checklist_fragments.length > 0 &&
    !sessionState.fragments_submitted;
  const showHero = !chatFocused && !isInitializing && messages.length === 1 && messages[0]?.role === 'assistant';
  const textareaPlaceholder = showHero
    ? 'Start typing...'
    : isComplete
    ? 'Anything else on your mind...'
    : STAGE_PLACEHOLDERS[sessionState.current_stage] || 'Tell me more...';

  return (
    <AppShellV2
      title="Nightly Reflection"
      adminAction={
        isAdmin ? (
          <button
            onClick={handleAdminReset}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 border border-zinc-800 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Reset
          </button>
        ) : null
      }
    >
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-950">
          <ProgressBar currentStage={isComplete ? 'complete' : sessionState.current_stage} stages={stages} />
        </div>

        <AnimatePresence mode="wait">
          {isInitializing ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
                <p className="text-zinc-500 text-sm">Loading your session...</p>
              </div>
            </motion.div>
          ) : showHero ? (
            <motion.div
              key="hero"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.25 } }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="flex-1 flex flex-col items-center justify-start pt-20 px-4 pb-8"
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
                className="bg-zinc-800 border border-zinc-700 rounded-2xl px-8 py-5 max-w-2xl w-full"
              >
                <p
                  className="text-2xl font-semibold text-white text-center leading-snug"
                >
                  {messages[0].content}
                </p>
              </motion.div>
              {messages[0].chips && messages[0].chips.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut', delay: 0.25 }}
                  className="flex flex-wrap gap-2 mt-6 justify-center"
                >
                  {messages[0].chips.map((chip) => (
                    <button
                      key={chip.value}
                      onClick={() => handleChipSelect(chip, messages[0].id)}
                      disabled={usedChipMessageIds.has(messages[0].id) || isLoading}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        usedChipMessageIds.has(messages[0].id) || isLoading
                          ? 'bg-zinc-800 border-zinc-700 text-zinc-600 cursor-not-allowed'
                          : 'bg-zinc-800 border-zinc-600 text-zinc-200 hover:bg-red-900 hover:border-red-700 hover:text-white cursor-pointer'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="flex-1 overflow-y-auto px-4 py-4"
            >
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isFirstMessage={index === 0 && message.role === 'assistant'}
                  onChipSelect={(chip) => handleChipSelect(chip, message.id)}
                  chipsDisabled={usedChipMessageIds.has(message.id) || isLoading}
                  streak={streak}
                  followThroughStats={followThroughStats}
                />
              ))}
              {sessionState.checklist_fragments.length > 0 && !sessionState.fragments_submitted && (
                <div className="mx-4 mb-3 bg-zinc-900 border border-zinc-700 rounded-xl p-4">
                  <p className="text-sm text-zinc-400 mb-3">Check off what you completed:</p>
                  {sessionState.checklist_fragments.map((frag) => (
                    <label key={frag.id} className="flex items-start gap-3 mb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-red-500"
                        checked={!!checkedFragments[frag.id]}
                        onChange={(e) => setCheckedFragments((prev) => ({ ...prev, [frag.id]: e.target.checked }))}
                      />
                      <span className="text-sm text-white">{frag.text}</span>
                    </label>
                  ))}
                  <button
                    onClick={handleChecklistSubmit}
                    className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                  >
                    Submit
                  </button>
                </div>
              )}
              {initError && (
                <div className="flex justify-center mt-3">
                  <button
                    onClick={() => {
                      initCalledRef.current = false;
                      setInitError(false);
                      initSession();
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {/* Inline goal suggestion card */}
              {pendingGoalSuggestion && (
                <div className="mx-0 mt-3 mb-2 bg-zinc-900 border border-zinc-700 rounded-2xl p-4">
                  <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Suggested goal</p>
                  <p className="text-white font-medium text-sm mb-1">{pendingGoalSuggestion.title}</p>
                  {pendingGoalSuggestion.category && (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs mb-3">
                      {pendingGoalSuggestion.category.replace('_', ' ')}
                    </span>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={handleAcceptGoalSuggestion}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-medium transition-colors"
                    >
                      Add this goal
                    </button>
                    <button
                      onClick={() => setPendingGoalSuggestion(null)}
                      className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl text-sm transition-colors"
                    >
                      Not now
                    </button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
          <div className="space-y-2">
            {isChecklistBlocking && (
              <p className="text-xs text-zinc-500">Complete the check-in above to continue</p>
            )}
            <div className="flex items-end gap-3">
            {showGoalChips && activeGoals.length > 0 ? (
              <div className="flex-1 border border-zinc-700 rounded-2xl bg-zinc-900 overflow-hidden">
                <div className="flex flex-wrap gap-2 p-3 border-b border-zinc-700">
                  {activeGoals.map((goal) => {
                    const isSelected = selectedGoalChips.includes(goal.title);
                    return (
                      <button
                        key={goal.id}
                        onClick={() => {
                          setSelectedGoalChips((prev) =>
                            isSelected ? prev.filter((t) => t !== goal.title) : [...prev, goal.title]
                          );
                        }}
                        disabled={isLoading || isInitializing}
                        className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                          isSelected
                            ? 'bg-red-600 border border-red-600 text-white'
                            : 'border border-zinc-600 text-zinc-300 bg-transparent'
                        }`}
                      >
                        {goal.title}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setChatFocused(true)}
                  disabled={isInitializing || isChecklistBlocking}
                  placeholder="Anything else on your mind..."
                  rows={1}
                  className="w-full bg-transparent px-4 py-3 text-sm text-white placeholder-zinc-500 resize-none focus:outline-none"
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                />
              </div>
            ) : (
              <div className="flex-1">
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setChatFocused(true)}
                  disabled={isInitializing || isChecklistBlocking}
                  placeholder={textareaPlaceholder}
                  rows={1}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                />
              </div>
            )}
            <button
              onClick={handleSend}
              disabled={
                (showGoalChips
                  ? selectedGoalChips.length === 0 && !inputValue.trim()
                  : !inputValue.trim()
                ) || isLoading || isInitializing
                  || isChecklistBlocking
              }
              className="w-10 h-10 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center flex-shrink-0"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
            </div>
          </div>
        </div>
      </div>
    </AppShellV2>
  );
}
