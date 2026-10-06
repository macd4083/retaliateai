import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppShellV2 from '../../components/v2/AppShellV2';
import { useAuth } from '../../lib/AuthContext';
import { loadTodayV2HomeState, setFollowThroughCompletion, upsertHabitLog } from '../services/todayReview';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import {
  getTodayV2CommitmentStateLabel,
  getTodayV2NextBoundaryDate,
} from '../today/model';
import { TODAY_V2_COMMITMENT_STATES } from '../today/types';

function SegmentedChoice({ value, options, onChange, disabled = false }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-zinc-700">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active && option.allowToggleOff ? null : option.value)}
            className={`px-3 py-1.5 text-xs transition-colors ${active ? 'bg-red-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-white'} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function formatPercent(rate) {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function formatBoundaryTime(dayBoundaryHour) {
  const nextBoundary = getTodayV2NextBoundaryDate({ dayBoundaryHour });
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(nextBoundary);
}

function ScheduleTime({ schedule, timezone }) {
  if (!schedule) return null;
  const options = { timeZone: timezone || 'UTC', hour: 'numeric', minute: '2-digit' };
  const dateOptions = { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' };
  const start = new Date(schedule.starts_at);
  const end = new Date(schedule.ends_at);
  const nextDay = new Intl.DateTimeFormat('en-CA', dateOptions).format(start) !== new Intl.DateTimeFormat('en-CA', dateOptions).format(end);
  return <span className="mt-1 block text-xs text-red-300">{new Intl.DateTimeFormat(undefined, options).format(start)}–{new Intl.DateTimeFormat(undefined, options).format(end)}{nextDay ? ' (+1 day)' : ''}</span>;
}

function NumericHabitCheckIn({ occurrence, disabled, onSave }) {
  const [draft, setDraft] = React.useState(occurrence.numeric_response ?? '');
  React.useEffect(() => setDraft(occurrence.numeric_response ?? ''), [occurrence.id, occurrence.numeric_response]);
  return <label className="flex items-center gap-2 text-xs text-zinc-400">{occurrence.snapshot_unit || 'Value'}<input aria-label={`${occurrence.snapshot_name} value`} type="number" disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => onSave(draft === '' ? null : Number(draft))} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-white" /></label>;
}

export default function HomeV2Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [homeState, setHomeState] = React.useState(null);
  const [commitmentSaveError, setCommitmentSaveError] = React.useState(null);

  const load = React.useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setHomeState(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setHomeState(await loadTodayV2HomeState(user.id));
    } catch (loadError) {
      console.error('[HomeV2] load failed:', loadError);
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  const actionsLocked = Boolean(homeState?.review?.completed_at);

  const onSaveCommitmentCompletion = async (fragmentId, completionState) => {
    const nextState = completionState || TODAY_V2_COMMITMENT_STATES.UNANSWERED;
    setCommitmentSaveError(null);

    try {
      if (actionsLocked) return;
      await setFollowThroughCompletion(fragmentId, nextState);
      await load();
    } catch (saveError) {
      console.error('[HomeV2] commitment save failed:', saveError);
      setCommitmentSaveError('Could not update that checklist item. Please try again.');
    }
  };

  const onSaveHabit = async (occurrence, value) => {
    if (actionsLocked) return;
    setCommitmentSaveError(null);
    try {
      const saved = await upsertHabitLog(occurrence.id, occurrence.snapshot_response_type, value);
      setHomeState((previous) => ({
        ...previous,
        habitOccurrences: previous.habitOccurrences.map((habit) => habit.id === occurrence.id ? { ...habit, ...saved } : habit),
      }));
    } catch {
      setCommitmentSaveError('Could not update that habit. Please try again.');
    }
  };

  if (loading) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center text-zinc-400">Loading Proof…</div>
      </AppShellV2>
    );
  }

  if (error) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-center">
            <h2 className="font-semibold text-white">Couldn’t load Today</h2>
            <p className="text-sm text-zinc-400">Could not load your Proof screen. Please try again.</p>
            <button type="button" onClick={load} className="inline-flex rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold">Try again</button>
          </div>
        </div>
      </AppShellV2>
    );
  }

  if (!homeState) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center text-zinc-400">Preparing Proof…</div>
      </AppShellV2>
    );
  }

  const contractItems = homeState.review?.completed_at ? homeState.tomorrowFragments : [];
  const findSchedule = (schedules, sourceId) => ENABLE_TODAY_V2_SCHEDULER ? (schedules || []).find((schedule) => schedule.source_id === sourceId || schedule.commitment_fragment_id === sourceId || schedule.habit_definition_id === sourceId) : null;
  const todayHabits = homeState.habitOccurrences || [];

  return (
    <AppShellV2 title="Today">
      <div className="h-full space-y-4 overflow-y-auto p-4">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-red-300">Identity</p>
          <p className="mt-3 text-xl font-semibold text-white">
            {homeState.latestDesiredDirection || 'Who are you becoming, or what are you changing about yourself?'}
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="font-semibold text-white">Tomorrow you said you&apos;d prove it by:</h2>
          {homeState.review?.controllable_focus && (
            <p className="mt-3 text-sm text-zinc-300">
              <span className="font-medium text-white">Under your control:</span> {homeState.review.controllable_focus}
            </p>
          )}
          {contractItems.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {contractItems.map((item) => (
                <li key={item.id} className="rounded-xl border border-zinc-800 px-3 py-2 text-sm text-zinc-200">
                  {item.normalized_fragment_text || item.fragment_text}
                  <ScheduleTime schedule={findSchedule(homeState.tomorrowSchedules, item.id)} timezone={homeState.timezoneName} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Finish tonight&apos;s review to lock in tomorrow&apos;s contract.</p>
          )}
          {homeState.review?.completed_at && homeState.firstFiveMinutes && (
            <p className="mt-3 text-sm text-zinc-300">
              <span className="font-medium text-white">Start with:</span> {homeState.firstFiveMinutes}
            </p>
          )}
          {ENABLE_TODAY_V2_SCHEDULER && homeState.review?.completed_at && (homeState.tomorrowSchedules || []).filter((schedule) => schedule.habit_definition_id || schedule.source_type === 'habit').map((schedule) => {
            const habit = (homeState.habitDefinitions || []).find((candidate) => candidate.id === (schedule.habit_definition_id || schedule.source_id));
            return habit ? <div key={schedule.id || schedule.habit_definition_id || schedule.source_id} className="mt-2 rounded-lg border border-zinc-800 p-2 text-sm text-zinc-300">{habit.name} · Habit<ScheduleTime schedule={schedule} timezone={homeState.timezoneName} /></div> : null;
          })}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-white">Today&apos;s actions checklist</h2>
            {!homeState.review?.completed_at && (
              <button type="button" onClick={() => navigate('/today')} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold">
                Start tonight&apos;s review
              </button>
            )}
          </div>
          {commitmentSaveError && <p className="mt-3 text-xs text-amber-300">{commitmentSaveError}</p>}
          {homeState.todayFirstFiveMinutes && (
            <p className="mt-3 text-sm text-zinc-300">
              <span className="font-medium text-white">Start with:</span> {homeState.todayFirstFiveMinutes}
            </p>
          )}
          {homeState.followThroughItems.length > 0 ? (
            <div className="mt-3 space-y-2">
              {homeState.followThroughItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-zinc-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-sm text-zinc-200">{item.normalized_fragment_text || item.fragment_text}</p><ScheduleTime schedule={findSchedule(homeState.todaySchedules, item.id)} timezone={homeState.timezoneName} /></div>
                    <span className="text-xs text-zinc-500">{getTodayV2CommitmentStateLabel(item.completion_state)}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <SegmentedChoice
                      disabled={actionsLocked}
                      value={item.completion_state}
                      onChange={(nextValue) => onSaveCommitmentCompletion(item.id, nextValue || TODAY_V2_COMMITMENT_STATES.UNANSWERED)}
                      options={[
                        { value: TODAY_V2_COMMITMENT_STATES.KEPT, label: 'Kept', allowToggleOff: true },
                        { value: TODAY_V2_COMMITMENT_STATES.NOT_KEPT, label: 'Not kept', allowToggleOff: true },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No live commitments yet for today.</p>
          )}
        </section>

        {ENABLE_TODAY_V2_SCHEDULER && (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="font-semibold text-white">Today&apos;s habits</h2>
            <p className="mt-1 text-xs text-zinc-400">{homeState.todayLocalDate} · {homeState.timezoneName}</p>
            {todayHabits.length ? <div className="mt-3 space-y-2">{todayHabits.map((habit) => (
              <div key={habit.id} className="space-y-2 rounded-xl border border-zinc-800 p-3">
                <p className="text-sm text-zinc-200">{habit.snapshot_name}</p>
                <ScheduleTime schedule={findSchedule(homeState.todaySchedules, habit.id) || findSchedule(homeState.todaySchedules, habit.habit_definition_id)} timezone={homeState.timezoneName} />
                {habit.snapshot_response_type === 'boolean' ? <div className="flex items-center gap-2"><SegmentedChoice disabled={actionsLocked} value={habit.answered_at ? habit.boolean_response ? 'yes' : 'no' : null} onChange={(value) => onSaveHabit(habit, value === null ? null : value === 'yes')} options={[{ value: 'yes', label: 'Yes', allowToggleOff: true }, { value: 'no', label: 'No', allowToggleOff: true }]} />{!actionsLocked && habit.answered_at && <button type="button" className="text-xs text-zinc-400" onClick={() => onSaveHabit(habit, null)}>Clear</button>}</div> : <NumericHabitCheckIn occurrence={habit} disabled={actionsLocked} onSave={(value) => onSaveHabit(habit, value)} />}
              </div>
            ))}</div> : <p className="mt-3 text-sm text-zinc-500">No habits scheduled for today.</p>}
            {homeState.scheduleAvailable === false && <p className="mt-3 text-xs text-amber-300">Schedule times are unavailable. Your check-ins still work.</p>}
          </section>
        )}

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500">Review streak</p>
            <p className="mt-2 text-2xl font-semibold text-white">{homeState.metrics.reviewStreak}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500">7-day kept rate</p>
            <p className="mt-2 text-2xl font-semibold text-white">{formatPercent(homeState.metrics.sevenDayCommitmentRate.rate)}</p>
            <p className="mt-1 text-xs text-zinc-500">{homeState.metrics.sevenDayCommitmentRate.kept}/{homeState.metrics.sevenDayCommitmentRate.answered} answered</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500">30-day kept rate</p>
            <p className="mt-2 text-2xl font-semibold text-white">{formatPercent(homeState.metrics.thirtyDayCommitmentRate.rate)}</p>
            <p className="mt-1 text-xs text-zinc-500">{homeState.metrics.thirtyDayCommitmentRate.kept}/{homeState.metrics.thirtyDayCommitmentRate.answered} answered</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500">7-day dots</p>
            <div className="mt-3 flex items-center gap-2">
              {homeState.metrics.sevenDayDots.map((dot) => (
                <span key={dot.localDate} title={dot.localDate} className={`h-3 w-3 rounded-full ${dot.completed ? 'bg-red-500' : 'bg-zinc-700'}`} />
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="font-semibold text-white">Habit momentum (7 days)</h2>
          {homeState.metrics.perHabitRates.length > 0 ? (
            <div className="mt-3 space-y-2">
              {homeState.metrics.perHabitRates.map((habit) => (
                <div key={`${habit.name}-${habit.responseType}`} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 px-3 py-2 text-sm">
                  <span className="text-zinc-200">{habit.name}</span>
                  <span className="text-zinc-400">
                    {habit.responseType === 'boolean'
                      ? `${habit.kept}/${habit.answered || 0} yes • ${formatPercent(habit.rate)}`
                      : `${habit.answered}/${habit.scheduled || 0} answered • ${formatPercent(habit.rate)}`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Habit momentum will appear after a few check-ins.</p>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="font-semibold text-white">Next check-in</h2>
          {homeState.review?.completed_at ? (
            <p className="mt-3 text-sm text-zinc-300">Tonight&apos;s review opens at {formatBoundaryTime(homeState.dayBoundaryHour)}.</p>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-300">Your nightly review is still open.</p>
              <button type="button" onClick={() => navigate('/today')} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold">Go to tonight&apos;s review</button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/70 p-4">
          <h2 className="font-semibold text-white">Weekly review — coming Monday</h2>
          <p className="mt-2 text-sm text-zinc-500">This space will turn your daily proof into a weekly reset.</p>
        </section>
      </div>
    </AppShellV2>
  );
}
