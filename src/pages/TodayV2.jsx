import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  Target,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AppShellV2 from '../components/v2/AppShellV2';
import { useAuth } from '../lib/AuthContext';
import { localDateStr } from '../lib/dateUtils';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';

const OUTCOME_OPTIONS = [
  { key: 'kept', label: 'Done' },
  { key: 'partial', label: 'Partial' },
  { key: 'missed', label: 'Missed' },
];

function formatSessionDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function offsetDateStr(dateStr, offsetDays) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getNoteStorageKey(userId, dateStr) {
  if (!userId || !dateStr) return null;
  return `retaliateai:today-note:${userId}:${dateStr}`;
}

function readLocalNote(storageKey) {
  if (!storageKey || typeof window === 'undefined') return '';

  try {
    return window.localStorage.getItem(storageKey) || '';
  } catch (_error) {
    return '';
  }
}

function writeLocalNote(storageKey, value) {
  if (!storageKey || typeof window === 'undefined') return false;

  try {
    if (value) {
      window.localStorage.setItem(storageKey, value);
    } else {
      window.localStorage.removeItem(storageKey);
    }
    return true;
  } catch (_error) {
    return false;
  }
}

export default function TodayV2() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessionDate, setSessionDate] = useState(localDateStr());
  const [plan, setPlan] = useState({ title: '', minimum: '', stretch: '' });
  const [status, setStatus] = useState(null);
  const [notes, setNotes] = useState('');
  const [noteReady, setNoteReady] = useState(false);
  const [noteTouched, setNoteTouched] = useState(false);
  const [noteStorageState, setNoteStorageState] = useState('idle');
  const [outcomeSaveState, setOutcomeSaveState] = useState('idle');
  const [outcomeError, setOutcomeError] = useState('');

  const todayLabel = useMemo(() => formatSessionDate(sessionDate), [sessionDate]);
  const noteStorageKey = useMemo(
    () => getNoteStorageKey(user?.id, sessionDate),
    [sessionDate, user?.id]
  );
  const hasPlan = Boolean(plan.title);
  const isSavingOutcome = outcomeSaveState === 'saving';
  const canContinueToPlan = Boolean(status) && !isSavingOutcome;

  const loadToday = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setLoadError('');
    setNoteReady(false);
    setNoteTouched(false);

    try {
      const todaySession = await reflectionHelpers.getTodaySession(user.id);
      const resolvedDate = todaySession.date || localDateStr();

      setSessionId(todaySession.id);
      setSessionDate(resolvedDate);
      setStatus(todaySession.checkin_outcome || null);
      setOutcomeSaveState(todaySession.checkin_outcome ? 'saved' : 'idle');

      const { data: yesterdayPlan, error } = await supabase
        .from('reflection_sessions')
        .select('tomorrow_commitment, commitment_minimum, commitment_stretch')
        .eq('user_id', user.id)
        .eq('date', offsetDateStr(resolvedDate, -1))
        .maybeSingle();

      if (error) throw error;

      setPlan({
        title: yesterdayPlan?.tomorrow_commitment || '',
        minimum: yesterdayPlan?.commitment_minimum || '',
        stretch: yesterdayPlan?.commitment_stretch || '',
      });

      const storedNote = readLocalNote(getNoteStorageKey(user.id, resolvedDate));
      setNotes(storedNote);
      setNoteStorageState(storedNote ? 'saved' : 'idle');
      setNoteReady(true);
    } catch (error) {
      console.error('[TodayV2] load failed:', error);
      setLoadError('Could not load today’s focus right now. Please try again.');
      setSessionId(null);
      setStatus(null);
      setPlan({ title: '', minimum: '', stretch: '' });
      setNotes('');
      setNoteStorageState('idle');
      setOutcomeSaveState('idle');
      setOutcomeError('');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (!noteReady || !noteStorageKey || !noteTouched) return;

    const didSave = writeLocalNote(noteStorageKey, notes.trim());
    setNoteStorageState(didSave ? 'saved' : 'error');
  }, [noteReady, noteStorageKey, noteTouched, notes]);

  const handleOutcome = async (outcome) => {
    if (!sessionId || !hasPlan || isSavingOutcome) return;

    const previousStatus = status;
    setStatus(outcome);
    setOutcomeSaveState('saving');
    setOutcomeError('');

    try {
      const updatedSession = await reflectionHelpers.updateSession(sessionId, {
        commitment_checkin_done: true,
        checkin_outcome: outcome,
      });

      setStatus(updatedSession.checkin_outcome || outcome);
      setOutcomeSaveState('saved');
    } catch (error) {
      console.error('[TodayV2] failed to save outcome:', error);
      setStatus(previousStatus);
      setOutcomeSaveState('error');
      setOutcomeError('Could not save your check-in. Please try again.');
    }
  };

  if (loading) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin text-red-400" />
            Loading today’s focus…
          </div>
        </div>
      </AppShellV2>
    );
  }

  if (loadError) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center px-4">
          <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-zinc-900 p-5 shadow-lg shadow-black/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-red-400" />
              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Couldn’t load Today</h2>
                  <p className="mt-1 text-sm text-zinc-300">{loadError}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={loadToday}
                    className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/reflection')}
                    className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
                  >
                    Open reflection
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppShellV2>
    );
  }

  return (
    <AppShellV2 title="Today">
      <div className="h-full overflow-y-auto px-4 pb-8 pt-5">
        <div className="mx-auto max-w-xl space-y-5">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg shadow-black/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Today</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{todayLabel}</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                  Use yesterday’s deliberate plan as today’s single focus. The goal here is one
                  high-value action, not a noisy task list.
                </p>
              </div>
              <div className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-red-300">
                Focus
              </div>
            </div>

            {hasPlan ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-zinc-950/80 p-4">
                <div className="mb-2 flex items-center gap-2 text-red-300">
                  <Target className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-[0.2em]">
                    Highest-ROI focus from last night
                  </span>
                </div>
                <p className="text-base font-medium leading-relaxed text-white">{plan.title}</p>
                {(plan.minimum || plan.stretch) && (
                  <dl className="mt-4 space-y-2 text-sm text-zinc-300">
                    {plan.minimum && (
                      <div className="flex items-start gap-2">
                        <dt className="min-w-20 text-zinc-500">Minimum</dt>
                        <dd>{plan.minimum}</dd>
                      </div>
                    )}
                    {plan.stretch && (
                      <div className="flex items-start gap-2">
                        <dt className="min-w-20 text-zinc-500">Stretch</dt>
                        <dd>{plan.stretch}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/60 p-4">
                <h3 className="text-sm font-semibold text-white">No plan from yesterday yet</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  There isn’t a saved tomorrow commitment to carry into today. Open your nightly
                  reflection to define the next highest-ROI action.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/reflection')}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
                >
                  Plan in reflection
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2 text-zinc-200">
              <CheckCircle2 className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">
                Execution check-in
              </h3>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              Record the reality: done, partial, or missed. Your saved outcome will still be here
              after refresh.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {OUTCOME_OPTIONS.map((option) => {
                const selected = status === option.key;

                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleOutcome(option.key)}
                    disabled={!hasPlan || isSavingOutcome}
                    aria-pressed={selected}
                    className={[
                      'rounded-2xl border px-3 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50',
                      selected
                        ? 'border-red-500 bg-red-500/10 text-white'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-white',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div aria-live="polite" className="mt-3 min-h-6 text-sm">
              {isSavingOutcome && <span className="text-zinc-400">Saving outcome…</span>}
              {!isSavingOutcome && outcomeSaveState === 'saved' && status && (
                <span className="text-emerald-400">Outcome saved.</span>
              )}
              {!isSavingOutcome && outcomeSaveState === 'error' && (
                <span className="text-red-400">{outcomeError}</span>
              )}
              {!hasPlan && (
                <span className="text-zinc-500">
                  Outcome controls unlock after you set a plan in reflection.
                </span>
              )}
            </div>

            <label className="mt-4 block" htmlFor="today-note">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-500">
                Optional note
              </span>
              <textarea
                id="today-note"
                value={notes}
                onChange={(event) => {
                  setNoteTouched(true);
                  setNotes(event.target.value);
                }}
                rows={4}
                placeholder="What tangible result did this create? What benefit did acting produce? What got in the way?"
                className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </label>

            <div className="mt-2 text-xs leading-relaxed text-zinc-500">
              {noteStorageState === 'error'
                ? 'This note could not be stored locally right now.'
                : 'This note is stored on this device only for now. It is not synced to your account yet.'}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-3 flex items-center gap-2 text-zinc-200">
              <Clock3 className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">
                Night review
              </h3>
            </div>

            <p className="mb-4 text-sm leading-relaxed text-zinc-300">
              After you save today’s outcome, continue into the structured review-and-plan
              worksheet. The classic reflection chat still stays available.
            </p>

            <button
              type="button"
              onClick={() => navigate('/plan')}
              disabled={!canContinueToPlan}
              className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue to review &amp; plan
              <ArrowRight className="h-4 w-4" />
            </button>

            <div className="mt-3 text-xs leading-relaxed text-zinc-500">
              {canContinueToPlan
                ? 'Review Today comes first there, then Plan Tomorrow, then final confirmation.'
                : 'Save Done, Partial, or Missed first so the worksheet starts from real evidence.'}
            </div>

            <button
              type="button"
              onClick={() => navigate('/reflection')}
              className="mt-4 text-sm font-medium text-zinc-400 transition-colors hover:text-white focus:outline-none focus:text-white"
            >
              Prefer the chat? Open /reflection instead.
            </button>
          </section>
        </div>
      </div>
    </AppShellV2>
  );
}
