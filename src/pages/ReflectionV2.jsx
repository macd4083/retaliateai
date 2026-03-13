import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Moon, CheckCircle, Circle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';
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

const STAGES = [
  { id: 'wins', label: 'Wins' },
  { id: 'honest', label: 'Honest' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'close', label: 'Close' },
];

const STAGE_PLACEHOLDERS = {
  wins: 'How are you feeling tonight?',
  honest: 'Tell me more...',
  tomorrow: 'What will you commit to?',
  close: 'Write yourself a message...',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ currentStage }) {
  const stageIndex = STAGES.findIndex((s) => s.id === currentStage);

  return (
    <div className="flex items-center justify-center gap-3 py-3">
      {STAGES.map((stage, i) => {
        const isComplete = i < stageIndex;
        const isActive = i === stageIndex;

        return (
          <div key={stage.id} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              {isComplete ? (
                <CheckCircle className="w-4 h-4 text-red-500" />
              ) : isActive ? (
                <div className="w-4 h-4 rounded-full bg-red-600 ring-2 ring-red-400 ring-offset-1 ring-offset-zinc-950" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-600" />
              )}
              <span
                className={`text-xs ${
                  isActive ? 'text-red-400 font-medium' : isComplete ? 'text-red-600' : 'text-zinc-600'
                }`}
              >
                {stage.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={`w-8 h-px mb-4 ${i < stageIndex ? 'bg-red-600' : 'bg-zinc-700'}`}
              />
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

function SummaryCard({ data, streak }) {
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
          <div className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">📋</span>
            <div>
              <span className="text-zinc-400 text-xs">Tomorrow</span>
              <p className="text-white text-sm">{data.tomorrow_commitment}</p>
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
        {data.self_hype_message && (
          <div className="mt-4 p-3 bg-zinc-900 rounded-xl border border-zinc-700">
            <p className="text-zinc-300 text-sm italic">"{data.self_hype_message}"</p>
          </div>
        )}
      </div>
      <p className="text-zinc-500 text-xs mt-4 text-center italic">
        You're building the identity of someone who shows up.
      </p>
    </div>
  );
}

function ChatMessage({ message, onChipSelect, chipsDisabled, streak }) {
  const isUser = message.role === 'user';

  if (message.isTyping) return <TypingIndicator />;

  if (message.message_type === 'summary_card' && message.card_data) {
    return (
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-red-900 border border-red-700 flex items-center justify-center flex-shrink-0 mt-1">
          <Moon className="w-4 h-4 text-red-400" />
        </div>
        <div className="max-w-[80%]">
          <SummaryCard data={message.card_data} streak={streak} />
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
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-red-600 text-white rounded-tr-sm'
              : 'bg-zinc-800 border border-zinc-700 text-white rounded-tl-sm'
          }`}
        >
          {message.content}
        </div>

        {/* Quick-reply chips */}
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

  // FIX: Guard ref to ensure initSession only ever runs ONCE per mount,
  // even if user?.id changes multiple times due to Supabase auth events
  // firing INITIAL_SESSION then SIGNED_IN back-to-back on load.
  const initCalledRef = useRef(false);

  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
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
    self_hype_message: null,
  });
  const [summaryCardData, setSummaryCardData] = useState({});

  const timeContext = getTimeContext();

  // ── Scroll to bottom ──────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Initialize session ────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;
    // FIX: Only run once. Supabase fires auth events multiple times on mount
    // which caused initSession() → sendMessage('__INIT__') to run twice,
    // producing two duplicate opening messages from the AI.
    if (initCalledRef.current) return;
    initCalledRef.current = true;
    initSession();
  }, [user?.id]);

  async function initSession() {
    setIsInitializing(true);
    try {
      // Load user profile
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select(
            'display_name, full_name, identity_statement, big_goal, why, future_self, life_areas, blockers'
          )
          .eq('id', user.id)
          .maybeSingle();
        setUserProfile(profile);
      } catch (_e) {}

      // Load or create today's session
      const session = await reflectionHelpers.getTodaySession(user.id);
      setSessionId(session.id);
      setIsComplete(session.is_complete);

      // Restore session state
      const restoredState = {
        current_stage: session.current_stage || 'wins',
        mood_end_of_day: session.mood_end_of_day || null,
        steps_completed: [],
        wins: session.wins || [],
        misses: session.misses || [],
        blocker_tags: session.blocker_tags || [],
        tomorrow_commitment: session.tomorrow_commitment || null,
        self_hype_message: session.self_hype_message || null,
      };
      setSessionState(restoredState);

      // Load streak
      const currentStreak = await reflectionHelpers.getReflectionStreak(user.id);
      setStreak(currentStreak);

      // Load existing messages
      const existingMessages = await reflectionHelpers.getSessionMessages(session.id);

      if (existingMessages.length > 0) {
        const restored = existingMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          chips: m.chips || null,
          message_type: m.message_type || null,
          card_data: m.extracted_data?.card_data || null,
          isTyping: false,
        }));
        setMessages(restored);

        const usedIds = new Set(
          existingMessages
            .filter((m) => m.role === 'assistant' && m.chips)
            .map((m) => m.id)
        );
        setUsedChipMessageIds(usedIds);
      } else {
        // Brand new session — get opening AI message
        await sendMessage('__INIT__', session.id, restoredState);
      }
    } catch (error) {
      console.error('Failed to init reflection session:', error);
      setMessages([
        {
          id: Date.now(),
          role: 'assistant',
          content: "Couldn't load your session. Please refresh and try again.",
          chips: null,
          message_type: 'question',
          isTyping: false,
        },
      ]);
    } finally {
      setIsInitializing(false);
    }
  }

  // ── Build history for API ─────────────────────────────────────────────────

  function buildHistory(currentMessages) {
    return currentMessages
      .filter((m) => !m.isTyping && m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async function sendMessage(userText, overrideSessionId, overrideState) {
    const sid = overrideSessionId || sessionId;
    const state = overrideState || sessionState;
    if (!sid || !user?.id) return;

    const isInit = userText === '__INIT__';

    // Optimistically add user bubble (except for init)
    let updatedMessages = [...messages];
    if (!isInit) {
      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userText,
        chips: null,
        message_type: null,
        isTyping: false,
      };
      updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);

      // Save user message to DB (client-side, fire-and-forget)
      reflectionHelpers
        .saveMessage(sid, user.id, {
          role: 'user',
          content: userText,
          stage: state.current_stage,
        })
        .catch(() => {});
    }

    // Show typing indicator
    const typingId = `typing-${Date.now()}`;
    setMessages((prev) => [
      ...prev.filter((m) => !m.isTyping),
      { id: typingId, role: 'assistant', isTyping: true },
    ]);
    setIsLoading(true);

    try {
      // Get yesterday's commitment
      let yesterdayCommitment = null;
      try {
        yesterdayCommitment = await reflectionHelpers.getYesterdayCommitment(user.id);
      } catch (_e) {}

      // Fetch latest profile if we don't have it yet
      let profile = userProfile;
      if (!profile) {
        try {
          const { data } = await supabase
            .from('user_profiles')
            .select(
              'display_name, full_name, identity_statement, big_goal, why, future_self, life_areas, blockers'
            )
            .eq('id', user.id)
            .maybeSingle();
          profile = data;
          setUserProfile(data);
        } catch (_e) {}
      }

      // Added AbortController with 25s timeout to prevent silent hangs
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      let response;
      try {
        response = await fetch('/api/reflection-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            user_id: user.id,
            session_id: sid,
            session_state: {
              ...state,
              is_first_message: isInit,
              yesterday_commitment: yesterdayCommitment,
            },
            history: isInit ? [] : buildHistory(updatedMessages),
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
            },
          }),
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) throw new Error('API error');

      const data = await response.json();

      const aiMsgId = `ai-${Date.now()}`;
      const isSessionComplete = !!data.is_session_complete;
      const isSummaryCard = isSessionComplete || data.new_stage === 'complete';

      let newSummaryData = summaryCardData;
      if (data.extracted_data) {
        newSummaryData = { ...summaryCardData, ...data.extracted_data };
        setSummaryCardData(newSummaryData);
      }

      const aiMessage = {
        id: aiMsgId,
        role: 'assistant',
        content: data.assistant_message || '',
        chips: data.chips || null,
        message_type: isSummaryCard ? 'summary_card' : data.message_type || 'question',
        card_data: isSummaryCard ? newSummaryData : null,
        isTyping: false,
      };

      setMessages((prev) => {
        const without = prev.filter((m) => !m.isTyping);
        return [...without, aiMessage];
      });

      if (data.extracted_data || data.stage_advance) {
        const newState = { ...state };

        if (data.extracted_data?.mood) newState.mood_end_of_day = data.extracted_data.mood;
        if (data.extracted_data?.win_text)
          newState.wins = [...(newState.wins || []), { text: data.extracted_data.win_text }];
        if (data.extracted_data?.miss_text)
          newState.misses = [...(newState.misses || []), { text: data.extracted_data.miss_text }];
        if (data.extracted_data?.blocker_tags)
          newState.blocker_tags = [
            ...new Set([...(newState.blocker_tags || []), ...data.extracted_data.blocker_tags]),
          ];
        if (data.extracted_data?.tomorrow_commitment)
          newState.tomorrow_commitment = data.extracted_data.tomorrow_commitment;
        if (data.extracted_data?.self_hype_message)
          newState.self_hype_message = data.extracted_data.self_hype_message;

        if (data.stage_advance && data.new_stage) {
          newState.current_stage = data.new_stage;
        }

        setSessionState(newState);

        const dbUpdates = {};
        if (data.extracted_data?.mood) dbUpdates.mood_end_of_day = data.extracted_data.mood;
        if (data.extracted_data?.tomorrow_commitment)
          dbUpdates.tomorrow_commitment = data.extracted_data.tomorrow_commitment;
        if (data.extracted_data?.self_hype_message)
          dbUpdates.self_hype_message = data.extracted_data.self_hype_message;
        if (data.stage_advance && data.new_stage) dbUpdates.current_stage = data.new_stage;

        if (Object.keys(dbUpdates).length > 0) {
          reflectionHelpers.updateSession(sid, dbUpdates).catch(() => {});
        }
      }

      if (isSessionComplete) {
        setIsComplete(true);
        const finalStreak = streak + 1;
        setStreak(finalStreak);
        reflectionHelpers
          .updateSession(sid, {
            is_complete: true,
            current_stage: 'complete',
            completed_at: new Date().toISOString(),
            reflection_streak: finalStreak,
          })
          .catch(() => {});
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      const isTimeout = error.name === 'AbortError';
      setMessages((prev) => {
        const without = prev.filter((m) => !m.isTyping);
        return [
          ...without,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: isTimeout
              ? "That took too long on my end. Try sending that again — I'm here."
              : 'Something went wrong. Try sending that again.',
            chips: null,
            message_type: 'question',
            isTyping: false,
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  }

  // ── Handle chip selection ─────────────────────────────────────────────────

  function handleChipSelect(chip, messageId) {
    if (isLoading || isComplete) return;
    setUsedChipMessageIds((prev) => new Set([...prev, messageId]));
    sendMessage(chip.label);
  }

  // ── Handle send ────────────────────────���──────────────────────────────────

  function handleSend() {
    const text = inputValue.trim();
    if (!text || isLoading || isComplete) return;
    setInputValue('');
    sendMessage(text);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
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
    if (!isInitializing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isInitializing]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShellV2 title="Nightly Reflection">
      <div className="flex flex-col h-full">
        {/* Progress Bar */}
        <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-950">
          <ProgressBar currentStage={isComplete ? 'complete' : sessionState.current_stage} />
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isInitializing ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
                <p className="text-zinc-500 text-sm">Loading your session...</p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onChipSelect={(chip) => handleChipSelect(chip, message.id)}
                  chipsDisabled={usedChipMessageIds.has(message.id) || isLoading}
                  streak={streak}
                />
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Bar */}
        <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
          {isComplete ? (
            <div className="text-center py-2">
              <p className="text-zinc-500 text-sm">Tonight's reflection is complete. ✨</p>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                disabled={isLoading || isInitializing}
                placeholder={STAGE_PLACEHOLDERS[sessionState.current_stage] || 'Tell me more...'}
                rows={1}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 transition-colors disabled:opacity-50"
                style={{ minHeight: '44px', maxHeight: '120px' }}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading || isInitializing}
                className="w-10 h-10 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center flex-shrink-0"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShellV2>
  );
}