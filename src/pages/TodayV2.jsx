import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Clock3, Sparkles, Target, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AppShellV2 from '../components/v2/AppShellV2';
import { useAuth } from '../lib/AuthContext';
import { localDateStr } from '../lib/dateUtils';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';

const DEFAULT_HABITS = [
  { key: 'sleep', label: 'Sleep' },
  { key: 'movement', label: 'Movement' },
  { key: 'focus', label: 'Focused work' },
  { key: 'consistency', label: 'Follow-through' },
];

export default function TodayV2() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState('not_started');
  const [notes, setNotes] = useState('');
  const [selectedHabits, setSelectedHabits] = useState({});
  const [sessionDate, setSessionDate] = useState(localDateStr());

  useEffect(() => {
    if (!user?.id) return;

    const loadToday = async () => {
      setLoading(true);
      try {
        const todaySession = await reflectionHelpers.getTodaySession(user.id);
        setSessionId(todaySession.id);
        setSessionDate(todaySession.date || localDateStr());

        const { data: yesterdayPlan } = await supabase
          .from('reflection_sessions')
          .select('tomorrow_commitment, commitment_minimum, commitment_stretch, checkin_outcome, commitment_checkin_done')
          .eq('user_id', user.id)
          .eq('date', localDateStr(-1))
          .maybeSingle();

        if (yesterdayPlan) {
          setPlan({
            title: yesterdayPlan.tomorrow_commitment,
            minimum: yesterdayPlan.commitment_minimum,
            stretch: yesterdayPlan.commitment_stretch,
          });
        }

        if (todaySession.checkin_outcome) {
          setStatus(todaySession.checkin_outcome);
        }
      } catch (error) {
        console.error('[TodayV2] load failed:', error);
      } finally {
        setLoading(false);
      }
    };

    loadToday();
  }, [user?.id]);

  const todayLabel = useMemo(() => {
    const d = new Date(sessionDate + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }, [sessionDate]);

  const toggleHabit = (key) => {
    setSelectedHabits((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleOutcome = async (outcome) => {
    if (!sessionId) return;
    setStatus(outcome);
    try {
      await reflectionHelpers.updateSession(sessionId, {
        commitment_checkin_done: true,
        checkin_outcome: outcome,
      });
    } catch (error) {
      console.error('[TodayV2] failed to record completion state:', error);
    }
  };

  const canOpenReview = true;

  if (loading) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
        </div>
      </AppShellV2>
    );
  }

  return (
    <AppShellV2 title="Today">
      <div className="h-full overflow-y-auto px-4 pb-8 pt-5">
        <div className="mx-auto max-w-xl space-y-5">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg shadow-black/20">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Today</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{todayLabel}</h2>
              </div>
              <div className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-red-300">
                Focus
              </div>
            </div>

            {plan?.title ? (
              <div className="rounded-2xl border border-red-500/20 bg-zinc-950/80 p-4">
                <div className="mb-2 flex items-center gap-2 text-red-300">
                  <Target className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-[0.2em]">Highest-ROI action</span>
                </div>

                <p className="text-base font-medium leading-relaxed text-white">{plan.title}</p>

                {(plan.minimum || plan.stretch) && (
                  <div className="mt-3 space-y-2 text-sm">
                    {plan.minimum && (
                      <div className="flex items-start gap-2 text-zinc-300">
                        <span className="mt-0.5 text-green-400">•</span>
                        <span><span className="text-zinc-500">Minimum:</span> {plan.minimum}</span>
                      </div>
                    )}
                    {plan.stretch && (
                      <div className="flex items-start gap-2 text-zinc-300">
                        <span className="mt-0.5 text-purple-400">•</span>
                        <span><span className="text-zinc-500">Stretch:</span> {plan.stretch}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                No plan yet from last night. Go to your review and create tomorrow’s most important action.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-center gap-2 text-zinc-200">
              <Check className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">Status</h3>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'kept', label: 'Done' },
                { key: 'partial', label: 'Partial' },
                { key: 'missed', label: 'Missed' },
              ].map((option) => {
                const selected = status === option.key;
                return (
                  <button
                    key={option.key}
                    onClick={() => handleOutcome(option.key)}
                    className={[
                      'rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
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

            <label className="mt-4 block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-500">What happened?</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What changed? What did action create? What got in the way?"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-center gap-2 text-zinc-200">
              <Zap className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">Foundations</h3>
            </div>

            <div className="space-y-2">
              {DEFAULT_HABITS.map((habit) => {
                const checked = !!selectedHabits[habit.key];
                return (
                  <button
                    key={habit.key}
                    onClick={() => toggleHabit(habit.key)}
                    className={[
                      'flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors',
                      checked
                        ? 'border-red-500/40 bg-red-500/10 text-white'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-white',
                    ].join(' ')}
                  >
                    <span className="text-sm font-medium">{habit.label}</span>
                    <span className={[
                      'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                      checked
                        ? 'border-red-500 bg-red-500 text-white'
                        : 'border-zinc-600 text-zinc-500',
                    ].join(' ')}>
                      {checked ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-center gap-2 text-zinc-200">
              <Clock3 className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">Night review</h3>
            </div>

            <p className="mb-3 text-sm leading-relaxed text-zinc-300">
              Review what happened, identify the cost of inaction, and set tomorrow’s highest-ROI action.
            </p>

            <button
              onClick={() => navigate('/reflection')}
              className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              Open review
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-red-500/10 to-transparent p-4">
            <div className="mb-2 flex items-center gap-2 text-red-300">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-[0.2em]">Direction</span>
            </div>
            <p className="text-sm leading-relaxed text-zinc-200">
              {status === 'kept'
                ? 'You are building momentum with action. Let that consistency do the work.'
                : status === 'partial'
                  ? 'You moved, but not enough to fully create the result. Make the next step smaller and more specific.'
                  : status === 'missed'
                    ? 'The cost of inaction matters. Keep the next move small, real, and visible.'
                    : 'Your most important work is not perfection — it is being clear enough to do the right thing next.'}
            </p>
          </div>
        </div>
      </div>
    </AppShellV2>
  );
}

