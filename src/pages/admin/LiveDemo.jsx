import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Send, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase/client';
import AppShellV2 from '../../components/v2/AppShellV2';
import {
  DEFAULT_LIVE_DEMO_SCRIPT,
  LIVE_DEMO_CHANNEL_NAME,
  LIVE_DEMO_DATA_KEY,
  buildLiveDemoChecklist,
  getLiveDemoInitialStage,
  getLiveDemoStageForTurn,
  getLiveDemoStages,
  normalizeLiveDemoData,
  readLiveDemoScript,
} from '../../lib/liveDemo';

function ProgressBar({ currentStage, stages }) {
  const rawStageIndex = stages.findIndex((s) => s.id === currentStage);
  const stageIndex = rawStageIndex === -1
    ? (currentStage === 'complete' ? stages.length : null)
    : rawStageIndex;
  return (
    <div className="flex items-center justify-center gap-3 py-3">
      {stages.map((stage, i) => {
        const done = stageIndex !== null && i < stageIndex;
        const active = stageIndex !== null && i === stageIndex;
        return (
          <div key={stage.id} className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`rounded-full transition-all duration-200 ${
                  active ? 'w-3 h-3 bg-red-500' : done ? 'w-2 h-2 bg-red-700' : 'w-2 h-2 bg-zinc-600'
                }`}
              />
              <span className={`text-xs font-medium transition-opacity duration-200 ${active ? 'text-red-400 opacity-100' : 'opacity-0 select-none'}`}>
                {stage.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className={`w-8 h-px mb-4 ${stageIndex !== null && i < stageIndex ? 'bg-red-700' : 'bg-zinc-700'}`} />
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

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  if (message.isTyping) return <TypingIndicator />;
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
      </div>
    </div>
  );
}

function makeMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function DemoDataPanel({ checklist, goals, commitmentScore }) {
  const hasChecklist = Array.isArray(checklist) && checklist.length > 0;
  const hasGoals = Array.isArray(goals) && goals.length > 0;
  const hasScore = commitmentScore != null;

  if (!hasChecklist && !hasGoals && !hasScore) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4">
      {hasScore && (
        <div className="space-y-1">
          <div className="text-4xl font-bold text-white">
            {commitmentScore}<span className="text-xl text-zinc-400">/100</span>
          </div>
          <div className="text-xs text-zinc-400 uppercase tracking-wide">Commitment Score</div>
        </div>
      )}
      {hasScore && (hasChecklist || hasGoals) && (
        <div className="border-t border-zinc-800" />
      )}
      {hasChecklist && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Today&apos;s Checklist</p>
          <ul className="space-y-1.5">
            {checklist.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-zinc-200">
                <span>{item.checked ? '✅' : '⬜'}</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasChecklist && hasGoals && (
        <div className="border-t border-zinc-800" />
      )}
      {hasGoals && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Goals</p>
          <div className="space-y-2">
            {goals.map((goal, i) => (
              <div key={i} className="space-y-0.5">
                <p className="text-sm text-white font-medium">{goal.title}</p>
                {goal.why && (
                  <p className="text-xs text-zinc-400 italic">{goal.why}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveDemo() {
  const auth = /** @type {any} */ (useAuth());
  const user = auth?.user;
  const navigate = useNavigate();
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const timeoutIdsRef = useRef([]);

  const [isAdmin, setIsAdmin] = useState(null);
  const [script, setScript] = useState(DEFAULT_LIVE_DEMO_SCRIPT);
  const [checklist, setChecklist] = useState(() => buildLiveDemoChecklist(DEFAULT_LIVE_DEMO_SCRIPT, 0));
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [currentStage, setCurrentStage] = useState(() => getLiveDemoInitialStage(DEFAULT_LIVE_DEMO_SCRIPT));
  const [demoData, setDemoData] = useState(null);
  const stages = useMemo(() => getLiveDemoStages(script), [script]);
  const initialStage = useMemo(() => getLiveDemoInitialStage(script), [script]);

  const clearTimers = useCallback(() => {
    timeoutIdsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    timeoutIdsRef.current = [];
  }, []);

  const schedule = useCallback((fn, delay) => {
    const timeoutId = setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
      fn();
    }, delay);
    timeoutIdsRef.current.push(timeoutId);
  }, []);

  const resetPlayback = useCallback(() => {
    clearTimers();
    setMessages([]);
    setInputValue('');
    setCurrentTurnIndex(0);
    setIsPlaying(false);
    setIsComplete(false);
    setCurrentStage(initialStage);
    setChecklist(buildLiveDemoChecklist(script, 0));
  }, [clearTimers, initialStage, script]);

  const startPlayback = useCallback(() => {
    clearTimers();
    setMessages([]);
    setInputValue('');
    setCurrentTurnIndex(0);
    setIsComplete(false);
    setIsPlaying(true);
    setCurrentStage(initialStage);
    setChecklist(buildLiveDemoChecklist(script, 0));
  }, [clearTimers, initialStage, script]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (data?.role === 'admin') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          navigate('/reflection', { replace: true });
        }
      } catch (_e) {
        if (cancelled) return;
        setIsAdmin(false);
        navigate('/reflection', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextScript = readLiveDemoScript();
    setScript(nextScript);
    setChecklist(buildLiveDemoChecklist(nextScript, 0));
    setCurrentStage(getLiveDemoInitialStage(nextScript));
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LIVE_DEMO_DATA_KEY);
      if (raw) setDemoData(normalizeLiveDemoData(JSON.parse(raw)));
    } catch (_e) {}
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, [inputValue]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(LIVE_DEMO_CHANNEL_NAME);
    channel.onmessage = (event) => {
      const { type } = event.data || {};
      if (type === 'PLAY') {
        startPlayback();
      } else if (type === 'RESET') {
        resetPlayback();
      } else if (type === 'UPDATE_DEMO_DATA') {
        try {
          const raw = window.localStorage.getItem(LIVE_DEMO_DATA_KEY);
          if (raw) setDemoData(normalizeLiveDemoData(JSON.parse(raw)));
        } catch (_e) {}
      } else if (type === 'UPDATE_DEMO_SCRIPT') {
        const nextScript = readLiveDemoScript();
        clearTimers();
        setScript(nextScript);
        setMessages([]);
        setInputValue('');
        setCurrentTurnIndex(0);
        setIsPlaying(false);
        setIsComplete(false);
        setChecklist(buildLiveDemoChecklist(nextScript, 0));
        setCurrentStage(getLiveDemoInitialStage(nextScript));
      }
    };
    return () => channel.close();
  }, [clearTimers, startPlayback, resetPlayback]);

  useEffect(() => {
    if (!isPlaying) return;
    if (currentTurnIndex >= script.turns.length) {
      setChecklist(buildLiveDemoChecklist(script, script.turns.length));
      setIsPlaying(false);
      setIsComplete(true);
      return;
    }

    const turn = script.turns[currentTurnIndex];
    setCurrentStage(getLiveDemoStageForTurn(script, currentTurnIndex));
    setChecklist(buildLiveDemoChecklist(script, currentTurnIndex + 1));

    if (turn.role === 'coach') {
      const messageId = makeMessageId();
      setMessages((prev) => [...prev, { id: messageId, role: 'assistant', content: '', isTyping: true }]);

      schedule(() => {
        const fullText = turn.content;
        if (!fullText) {
          setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, isTyping: false, content: '' } : msg)));
          schedule(() => setCurrentTurnIndex((idx) => idx + 1), 900);
          return;
        }

        const revealNext = (charIndex) => {
          const content = fullText.slice(0, charIndex);
          setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, isTyping: false, content } : msg)));
          if (charIndex < fullText.length) {
            schedule(() => revealNext(charIndex + 1), 18);
            return;
          }
          schedule(() => setCurrentTurnIndex((idx) => idx + 1), 900);
        };

        revealNext(1);
      }, 600);

      return;
    }

    const userText = turn.content;
    if (!userText) {
      schedule(() => {
        setMessages((prev) => [...prev, { id: makeMessageId(), role: 'user', content: '', isTyping: false }]);
        setInputValue('');
        schedule(() => setCurrentTurnIndex((idx) => idx + 1), 700);
      }, 400);
      return;
    }

    const typeUserNext = (charIndex) => {
      const content = userText.slice(0, charIndex);
      setInputValue(content);
      if (charIndex < userText.length) {
        schedule(() => typeUserNext(charIndex + 1), 55);
        return;
      }
      schedule(() => {
        setMessages((prev) => [...prev, { id: makeMessageId(), role: 'user', content: userText, isTyping: false }]);
        setInputValue('');
        schedule(() => setCurrentTurnIndex((idx) => idx + 1), 700);
      }, 400);
    };

    typeUserNext(1);
  }, [isPlaying, currentTurnIndex, script, schedule]);

  const goals = Array.isArray(demoData?.goals) ? demoData.goals : [];
  const commitmentScore = demoData?.commitmentScore ?? null;
  const hasDemoPanelData = checklist.length > 0 || goals.length > 0 || commitmentScore != null;

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <AppShellV2 title="Nightly Reflection" shellMode="live-demo-user">
      <div className="flex flex-col md:flex-row h-full">
        <div className="flex-1 min-w-0 flex flex-col h-full">
          <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-950">
            <ProgressBar currentStage={isComplete ? 'complete' : currentStage} stages={stages} />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="flex-1 overflow-y-auto px-4 py-4"
          >
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </motion.div>

          <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="space-y-2">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    disabled
                    placeholder="Nightly Reflection"
                    rows={1}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
                    style={{ minHeight: '44px', maxHeight: '120px' }}
                  />
                </div>
                <button
                  disabled
                  className="w-10 h-10 rounded-xl bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center flex-shrink-0"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {hasDemoPanelData && (
          <div className="w-72 flex-shrink-0 overflow-y-auto p-4 border-l border-zinc-800">
            <DemoDataPanel checklist={checklist} goals={goals} commitmentScore={commitmentScore} />
          </div>
        )}
      </div>
    </AppShellV2>
  );
}
