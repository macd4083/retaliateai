import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppShellV2 from '../../components/v2/AppShellV2';
import { useAuth } from '../../lib/AuthContext';
import { loadTodayV2HomeState } from '../services/todayReview';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import GoogleCalendarConnection from '../components/GoogleCalendarConnection';
import TomorrowScheduler from '../components/TomorrowScheduler';
import TrendChart from '../components/TrendChart';
import { buildBecomingTrend } from '../today/trends';
import { updateDaySchedule, isMissingScheduleSchema } from '../services/scheduling';
import {
  getTodayV2NextBoundaryDate,
  getTodayV2DateContext,
  addDaysToLocalDate,
} from '../today/model';
import { clipScheduleBlocksToDate, getScheduleDateBounds, getScheduleDayOffset, getScheduleLocalDate } from '../today/scheduling';

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

function ScheduleTime({ schedule, timezone, localDate }) {
  if (!schedule) return null;
  try {
    const visible = localDate ? clipScheduleBlocksToDate([schedule], getScheduleDateBounds(localDate, timezone || 'UTC'))[0] : schedule;
    if (!visible) return null;
    const options = { timeZone: timezone || 'UTC', hour: 'numeric', minute: '2-digit' };
    const formatter = new Intl.DateTimeFormat(undefined, options);
    const dayOffset = getScheduleDayOffset(schedule.starts_at, schedule.ends_at, timezone || 'UTC');
    return <span className="mt-1 block text-xs text-red-300">{formatter.format(new Date(visible.visible_starts_at || visible.starts_at))}–{formatter.format(new Date(visible.visible_ends_at || visible.ends_at))}{dayOffset ? ` (+${dayOffset} day${dayOffset === 1 ? '' : 's'})` : ''}{visible.continued ? ' · Continued from previous day' : ''}{visible.continues ? ' · Continues tomorrow' : ''}</span>;
  } catch {
    return <span className="mt-1 block text-xs text-amber-300">Schedule time unavailable. Check your date and timezone settings.</span>;
  }
}

export default function HomeV2Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [homeState, setHomeState] = React.useState(null);
  const [googleEvents, setGoogleEvents] = React.useState([]);
  const [googleControls, setGoogleControls] = React.useState(null);
  const [googleWriting, setGoogleWriting] = React.useState(false);
  const [scheduleSaveStatus, setScheduleSaveStatus] = React.useState('idle');
  const [scheduleError, setScheduleError] = React.useState(null);
  const scopeRef = React.useRef(null);
  const schedulePending = React.useRef(false);
  const loadGeneration = React.useRef(0);

  const load = React.useCallback(async () => {
    const generation = ++loadGeneration.current;
    scopeRef.current = null;
    if (!user?.id) {
      setLoading(false);
      setHomeState(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const next = await loadTodayV2HomeState(user.id);
      if (generation !== loadGeneration.current) return;
      setHomeState(next);
      setScheduleSaveStatus('idle');
      setScheduleError(null);
    } catch (loadError) {
      if (generation !== loadGeneration.current) return;
      console.error('[HomeV2] load failed:', loadError);
      setError(loadError);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [user?.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    return () => { scopeRef.current = null; loadGeneration.current += 1; };
  }, [user?.id]);

  React.useEffect(() => {
    if (!homeState) return undefined;
    const refreshDate = () => {
      try {
        const currentDate = getScheduleLocalDate(new Date(), homeState.timezoneName || 'UTC');
        const reviewDate = getTodayV2DateContext({
          timezoneName: homeState.timezoneName || 'UTC', dayBoundaryHour: homeState.dayBoundaryHour,
        }).todayLocalDate;
        if (currentDate !== (homeState.civilScheduleLocalDate || homeState.todayLocalDate)
          || reviewDate !== homeState.todayLocalDate) void load();
      } catch { /* The calendar displays timezone diagnostics. */ }
    };
    const interval = window.setInterval(refreshDate, 60_000);
    window.addEventListener('focus', refreshDate);
    document.addEventListener('visibilitychange', refreshDate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshDate);
      document.removeEventListener('visibilitychange', refreshDate);
    };
  }, [homeState, load]);

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
  const todayDate = homeState.todayLocalDate;
  const tomorrowDate = homeState.planningLocalDate || homeState.tomorrowLocalDate || (todayDate ? addDaysToLocalDate(todayDate, 1) : null);
  let civilDate = todayDate;
  try {
    civilDate = homeState.civilScheduleLocalDate || getScheduleLocalDate(new Date(), homeState.timezoneName || 'UTC');
  } catch { /* ScheduleTime exposes invalid timezone diagnostics without blocking check-ins. */ }
  const visibleSchedules = (schedules, date) => {
    if (!date) return schedules || [];
    try { return clipScheduleBlocksToDate(schedules || [], getScheduleDateBounds(date, homeState.timezoneName || 'UTC')); }
    catch { return schedules || []; }
  };
  const todayVisible = visibleSchedules(homeState.todaySchedules, todayDate);
  const tomorrowVisible = visibleSchedules(homeState.planningSchedules || homeState.tomorrowSchedules, tomorrowDate);
  const civilDiffers = todayDate && civilDate > todayDate;
  const civilVisible = civilDiffers ? visibleSchedules(homeState.civilSchedules || homeState.tomorrowSchedules, civilDate) : [];
  const isCarryover = (schedule, date) => schedule.continued || schedule.read_only_context || Boolean(date && schedule.target_local_date && schedule.target_local_date < date);
  const tomorrowSchedules = tomorrowVisible.filter((schedule) => !isCarryover(schedule, tomorrowDate));
  const calendarSources = homeState.civilFollowThroughItems || (civilDiffers ? homeState.tomorrowFragments : homeState.followThroughItems) || [];
  const calendarHabits = homeState.civilHabitOccurrences || (civilDiffers ? [] : todayHabits);
  const calendarReview = homeState.civilReview === undefined ? (civilDiffers ? null : homeState.review) : homeState.civilReview;
  const calendarStarts = homeState.civilFirstFiveMinutes ?? (civilDiffers ? homeState.firstFiveMinutes : homeState.todayFirstFiveMinutes);
  const calendarItems = [
    ...calendarSources.map((item) => ({
      key: `action:${item.id}`, source_id: item.id, type: 'action', label: item.normalized_fragment_text || item.fragment_text,
    })),
    ...calendarHabits.map((habit) => ({
      key: `habit:${habit.habit_definition_id}`, source_id: habit.habit_definition_id, type: 'habit', label: habit.snapshot_name,
    })),
  ];
  const calendarBlocks = (civilDiffers ? civilVisible : todayVisible).map((block) => {
    const sourceId = block.source_id || block.commitment_fragment_id || block.habit_definition_id;
    const type = block.source_type || (block.habit_definition_id ? 'habit' : 'action');
    const sourceKey = block.source_key || `${type}:${sourceId}`;
    const item = calendarItems.find((candidate) => candidate.key === sourceKey);
    const definition = (homeState.habitDefinitions || []).find((habit) => habit.id === sourceId);
    return { ...block, source_key: sourceKey, label: block.label || item?.label || definition?.name };
  });
  const scope = `${user?.id}:${civilDate}:${homeState.timezoneName}`;
  scopeRef.current = scope;
  const saveCalendarItem = async (key, times = null) => {
    const generation = loadGeneration.current;
    const item = calendarItems.find((candidate) => candidate.key === key);
    if (!item || schedulePending.current || calendarReview?.completed_at || homeState.scheduleAvailable === false) return;
    if (getScheduleLocalDate(new Date(), homeState.timezoneName || 'UTC') !== civilDate) {
      throw new Error('The calendar date changed. Refresh Today before editing.');
    }
    schedulePending.current = true;
    setScheduleSaveStatus('saving');
    setScheduleError(null);
    try {
      const rows = await updateDaySchedule({
        userId: user.id,
        targetLocalDate: civilDate, timezoneName: homeState.timezoneName,
        sourceType: item.type, sourceId: item.source_id,
        startsAt: times?.starts_at ?? null, endsAt: times?.ends_at ?? null,
      });
      if (scopeRef.current !== scope || loadGeneration.current !== generation) return;
      setHomeState((previous) => {
        const merge = (blocks) => [
          ...(blocks || []).filter((block) => block.target_local_date && block.target_local_date !== civilDate), ...rows,
        ];
        return {
          ...previous,
          civilSchedules: merge(previous.civilSchedules || (civilDiffers ? previous.tomorrowSchedules : previous.todaySchedules)),
          ...(civilDate === previous.todayLocalDate ? { todaySchedules: merge(previous.todaySchedules) } : {}),
          ...(civilDate === previous.tomorrowLocalDate ? { tomorrowSchedules: merge(previous.tomorrowSchedules) } : {}),
        };
      });
      setScheduleSaveStatus('saved');
    } catch (failure) {
      if (scopeRef.current === scope && loadGeneration.current === generation) {
        setScheduleSaveStatus('error');
        setScheduleError(isMissingScheduleSchema(failure)
          ? 'Today calendar editing needs the 20261011_today_v2_day_schedule.sql migration. Apply it, then retry.'
          : failure.message || 'Could not save your calendar change. Please try again.');
      }
      throw failure;
    } finally {
      schedulePending.current = false;
    }
  };
  const carryover = (schedules, date, includeCurrent = false) => schedules.filter((schedule) => includeCurrent || isCarryover(schedule, date)).map((schedule) => {
    const sourceId = schedule.source_id || schedule.commitment_fragment_id || schedule.habit_definition_id;
    const source = [...homeState.followThroughItems, ...(homeState.tomorrowFragments || [])].find((item) => item.id === sourceId);
    const habit = (homeState.habitDefinitions || []).find((item) => item.id === sourceId);
    const snapshot = todayHabits.find((item) => item.habit_definition_id === sourceId || item.id === sourceId);
    const label = schedule.label || source?.normalized_fragment_text || source?.fragment_text || habit?.name || snapshot?.snapshot_name || (isCarryover(schedule, date) ? 'Previous-day plan' : 'Calendar-day plan');
    return <div key={schedule.id || `${sourceId}:${schedule.starts_at}`} data-carryover-schedule-id={isCarryover(schedule, date) ? schedule.id : undefined} className="mt-2 rounded-lg border border-indigo-800/60 p-2 text-sm text-zinc-300">{label}<ScheduleTime schedule={schedule} timezone={homeState.timezoneName} localDate={date} /><span className="block text-xs text-indigo-300">{isCarryover(schedule, date) ? 'Previous-day plan' : 'Calendar-day plan'} · read-only</span></div>;
  });
  const reviewCompleted = Boolean(homeState.review?.completed_at);
  // Between midnight and the review boundary the plan date is the calendar date, so Today's calendar already shows it.
  const planIsCalendarDay = reviewCompleted && Boolean(tomorrowDate) && tomorrowDate === civilDate;
  const tomorrowCalendarDate = !ENABLE_TODAY_V2_SCHEDULER ? null
    : homeState.tomorrowCalendarLocalDate !== undefined
      ? homeState.tomorrowCalendarLocalDate
      : (reviewCompleted && tomorrowDate && !planIsCalendarDay ? tomorrowDate : null);
  const tomorrowCalendarItems = tomorrowCalendarDate ? [
    ...(homeState.tomorrowFragments || []).map((item) => ({
      key: `action:${item.id}`, source_id: item.id, type: 'action', label: item.normalized_fragment_text || item.fragment_text,
    })),
    ...(homeState.habitDefinitions || [])
      .filter((habit) => tomorrowVisible.some((block) => (block.habit_definition_id || (block.source_type === 'habit' && block.source_id)) === habit.id))
      .map((habit) => ({ key: `habit:${habit.id}`, source_id: habit.id, type: 'habit', label: habit.name })),
  ] : [];
  const tomorrowCalendarBlocks = tomorrowCalendarDate ? tomorrowVisible.map((block) => {
    const sourceId = block.source_id || block.commitment_fragment_id || block.habit_definition_id;
    const type = block.source_type || (block.habit_definition_id ? 'habit' : 'action');
    const sourceKey = block.source_key || `${type}:${sourceId}`;
    const item = tomorrowCalendarItems.find((candidate) => candidate.key === sourceKey);
    const snapshot = todayHabits.find((candidate) => candidate.habit_definition_id === sourceId);
    return {
      ...block, source_key: sourceKey, label: block.label || item?.label || snapshot?.snapshot_name,
      ...(isCarryover(block, tomorrowCalendarDate) ? { read_only_context: true } : {}),
    };
  }) : [];

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
          <h2 className="font-semibold text-white">{planIsCalendarDay ? 'Today you said you\'d prove it by:' : 'Tomorrow you said you\'d prove it by:'}</h2>
          {ENABLE_TODAY_V2_SCHEDULER && <p className="mt-1 text-xs text-zinc-400">Planning date {tomorrowDate} · {homeState.timezoneName}</p>}
          {ENABLE_TODAY_V2_SCHEDULER && planIsCalendarDay && <p className="mt-1 text-xs text-zinc-400">This plan is for today, {civilDate}. Its times and start focus are in Today&apos;s calendar below.</p>}
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
                  {!(ENABLE_TODAY_V2_SCHEDULER && planIsCalendarDay) && <ScheduleTime schedule={findSchedule(tomorrowSchedules, item.id)} timezone={homeState.timezoneName} localDate={tomorrowDate} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Finish tonight&apos;s review to lock in tomorrow&apos;s contract.</p>
          )}
          {homeState.review?.completed_at && homeState.firstFiveMinutes && !tomorrowCalendarDate && !(ENABLE_TODAY_V2_SCHEDULER && planIsCalendarDay) && (
            <p className="mt-3 text-sm text-zinc-300">
              <span className="font-medium text-white">Start with:</span> {homeState.firstFiveMinutes}
            </p>
          )}
          {ENABLE_TODAY_V2_SCHEDULER && homeState.review?.completed_at && !planIsCalendarDay && tomorrowSchedules.filter((schedule) => schedule.habit_definition_id || schedule.source_type === 'habit').map((schedule) => {
            const sourceId = schedule.habit_definition_id || schedule.source_id;
            const habit = (homeState.habitDefinitions || []).find((candidate) => candidate.id === sourceId);
            const snapshot = todayHabits.find((candidate) => candidate.habit_definition_id === sourceId);
            return <div key={schedule.id || sourceId} className="mt-2 rounded-lg border border-zinc-800 p-2 text-sm text-zinc-300">{habit?.name || snapshot?.snapshot_name || 'Scheduled habit'} · Habit<ScheduleTime schedule={schedule} timezone={homeState.timezoneName} localDate={tomorrowDate} /></div>;
          })}
          {ENABLE_TODAY_V2_SCHEDULER && homeState.review?.completed_at && !planIsCalendarDay && carryover(tomorrowVisible, tomorrowDate)}
        </section>

        {tomorrowCalendarDate && <section aria-label={`Tomorrow's calendar for ${tomorrowCalendarDate}`} data-home-calendar="tomorrow" className="space-y-3">
          <p className="text-xs text-zinc-400">Tomorrow&apos;s plan · {tomorrowCalendarDate} · {homeState.timezoneName} · locked by tonight&apos;s review</p>
          {homeState.firstFiveMinutes && <p className="text-sm text-zinc-300"><span className="font-medium text-white">Start with:</span> {homeState.firstFiveMinutes}</p>}
          <TomorrowScheduler
            title={`Tomorrow · ${tomorrowCalendarDate}`}
            headingId="home-tomorrow-calendar-title"
            preserveUnmatchedBlocks
            userId={user?.id}
            localDate={tomorrowCalendarDate}
            timezone={homeState.timezoneName}
            items={tomorrowCalendarItems}
            blocks={tomorrowCalendarBlocks}
            available={homeState.scheduleAvailable !== false}
            availabilityError={homeState.scheduleDiagnostic?.message}
            onRetry={load}
            readOnly
          />
          <p className="text-xs text-zinc-500">This plan becomes Today&apos;s calendar and your Review &amp; Plan check-in after {formatBoundaryTime(homeState.dayBoundaryHour)}.</p>
        </section>}

        {ENABLE_TODAY_V2_SCHEDULER && <section aria-label={`Today's calendar for ${civilDate}`} data-home-calendar="today" className="space-y-3">
          <p className="text-xs text-zinc-400">Review day {todayDate} · {homeState.timezoneName}</p>
          {civilDiffers && <p className="text-xs text-zinc-400">Your checklist still belongs to review day {todayDate}; calendar days change at midnight.</p>}
          {calendarStarts && <p className="text-sm text-zinc-300"><span className="font-medium text-white">Start with:</span> {calendarStarts}</p>}
          <GoogleCalendarConnection userId={user?.id} localDate={civilDate} timezone={homeState.timezoneName} onEvents={setGoogleEvents} onControls={setGoogleControls} onWritePending={setGoogleWriting} returnPath="/home" completionSaving={scheduleSaveStatus === 'saving'} readOnly={Boolean(calendarReview?.completed_at)} />
          <TomorrowScheduler
            title={`Today's calendar · ${civilDate}`}
            preserveUnmatchedBlocks
            userId={user?.id}
            localDate={civilDate}
            timezone={homeState.timezoneName}
            items={calendarItems}
            blocks={calendarBlocks}
            googleEvents={googleEvents}
            showUnscheduledTray={false}
            onGoogleEdit={googleControls?.edit}
            onGoogleUpdate={googleControls?.update}
            onUpdate={saveCalendarItem}
            onUnschedule={(key) => saveCalendarItem(key)}
            saveStatus={scheduleSaveStatus}
            saveError={scheduleError}
            available={homeState.scheduleAvailable !== false}
            availabilityError={homeState.scheduleDiagnostic?.message}
            onRetry={load}
            readOnly={Boolean(calendarReview?.completed_at)}
            completionSaving={googleWriting}
          />
          <button type="button" onClick={() => navigate('/today')} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">Open Review &amp; Plan</button>
        </section>}

        <TrendChart
          title="Becoming"
          description="How you feel about your progress · past 7 days"
          points={buildBecomingTrend(homeState.becomingRatings, homeState.todayLocalDate)}
          min={1}
          max={10}
          unit="/10"
        />

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
