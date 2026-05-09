import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase/client';
import AppShellV2 from '../../components/v2/AppShellV2';

const DEMO_SCRIPT_KEY = 'retaliateai_live_demo_script';
const BASE_STAGES = [
  { id: 'commitment_checkin', label: 'Check-in' },
  { id: 'wins', label: 'Wins' },
  { id: 'honest', label: 'Honest' },
  { id: 'tomorrow', label: 'Tomorrow' },
];
const DEFAULT_DEMO_SCRIPT = [
  { role: 'coach', content: 'Hey — how are you feeling tonight?' },
  { role: 'user', content: 'honestly pretty decent. had a solid day' },
  { role: 'coach', content: 'Nice. What made it solid?' },
  { role: 'user', content: 'I finally got back to working on my app after like 2 weeks of avoiding it. got a decent chunk done' },
  { role: 'coach', content: 'Two weeks of avoiding it and you got back in. What broke the pattern today?' },
  { role: 'user', content: 'idk I just told myself to do 20 minutes and it turned into 2 hours' },
  { role: 'coach', content: "That's the move. What else went well?" },
  { role: 'user', content: 'not much else honestly. rest of the day was pretty meh' },
  { role: 'coach', content: "Okay. Is there a part of today you're being honest with yourself about — something that didn't go the way it should have?" },
  { role: 'user', content: "yeah. I said I'd reach out to 3 potential users this week. haven't done any of it" },
  { role: 'coach', content: "What's actually in the way — not the surface reason, but what's underneath it?" },
  { role: 'user', content: "I think I'm scared they'll say the idea is bad. like as long as I don't ask I can still tell myself it might work" },
  { role: 'coach', content: "That's the real one. Avoiding feedback is protecting the idea more than building it. What's the minimum you're committing to tomorrow — not what you hope to do, what you will do?" },
  { role: 'user', content: "one user conversation. I'll message two people tonight so it's already in motion" },
  { role: 'coach', content: "That's a real commitment. Which goal does that connect to most?" },
  { role: 'user', content: "building something people actually want. I can't know that without talking to them" },
  { role: 'coach', content: "Exactly. You already know what needs to happen — tonight you're making sure tomorrow it does. Good session." },
];

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

function normalizeScript(parsed) {
  if (!Array.isArray(parsed)) return DEFAULT_DEMO_SCRIPT;
  const normalized = parsed
    .map((turn) => ({
      role: turn?.role === 'coach' ? 'coach' : turn?.role === 'user' ? 'user' : null,
      content: typeof turn?.content === 'string' ? turn.content : '',
    }))
    .filter((turn) => turn.role && turn.content);
  return normalized.length > 0 ? normalized : DEFAULT_DEMO_SCRIPT;
}

export default function LiveDemo() {
  const auth = /** @type {any} */ (useAuth());
  const user = auth?.user;
  const navigate = useNavigate();
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const timeoutIdsRef = useRef([]);

  const [isAdmin, setIsAdmin] = useState(null);
  const [script, setScript] = useState(DEFAULT_DEMO_SCRIPT);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

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
  }, [clearTimers]);

  const startPlayback = useCallback(() => {
    clearTimers();
    setMessages([]);
    setInputValue('');
    setCurrentTurnIndex(0);
    setIsComplete(false);
    setIsPlaying(true);
  }, [clearTimers]);

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
    try {
      const saved = window.localStorage.getItem(DEMO_SCRIPT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setScript(normalizeScript(parsed));
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
    const channel = new BroadcastChannel('retaliateai-live-demo');
    channel.onmessage = (event) => {
      const { type } = event.data || {};
      if (type === 'PLAY') {
        startPlayback();
      } else if (type === 'RESET') {
        resetPlayback();
      }
    };
    return () => channel.close();
  }, [startPlayback, resetPlayback]);

  useEffect(() => {
    if (!isPlaying) return;
    if (currentTurnIndex >= script.length) {
      setIsPlaying(false);
      setIsComplete(true);
      return;
    }

    const turn = script[currentTurnIndex];

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

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <AppShellV2 title="Live Demo">
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-950">
          <ProgressBar currentStage={isComplete ? 'complete' : 'wins'} stages={BASE_STAGES} />
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
                  placeholder="How are you feeling tonight?"
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
    </AppShellV2>
  );
}
