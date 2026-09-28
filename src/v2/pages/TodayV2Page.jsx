import React, { useMemo, useState } from 'react';
import AppShellV2 from '../../components/v2/AppShellV2';
import { useAuth } from '../../lib/AuthContext';
import { splitCommitmentIntoTasks } from '../../lib/commitmentFragments';
import {
  WEEKDAY_LABELS,
  addManualFollowThroughItem,
  archiveHabit,
  loadTodayReviewState,
  replaceTomorrowActions,
  seedDefaultHabits,
  setFollowThroughCompletion,
  updateDesiredDirection,
  upsertHabitDefinition,
  upsertHabitLog,
  weekdayIndexToday,
} from '../services/todayReview';

const EMPTY_HABIT_FORM = {
  id: null,
  name: '',
  habit_type: 'boolean',
  unit: '',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
};

function HabitEditorModal({ value, onClose, onSave }) {
  const [draft, setDraft] = useState(value || EMPTY_HABIT_FORM);

  const toggleWeekday = (dayIndex) => {
    setDraft((prev) => {
      const hasDay = prev.weekdays.includes(dayIndex);
      const nextWeekdays = hasDay
        ? prev.weekdays.filter((d) => d !== dayIndex)
        : [...prev.weekdays, dayIndex].sort((a, b) => a - b);
      return { ...prev, weekdays: nextWeekdays };
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Edit Habit</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>

        <input
          value={draft.name}
          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Habit name"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDraft((prev) => ({ ...prev, habit_type: 'boolean', unit: '' }))}
            className={`rounded-lg border px-3 py-2 text-sm ${draft.habit_type === 'boolean' ? 'border-red-500 text-white' : 'border-zinc-700 text-zinc-400'}`}
          >
            Yes / No
          </button>
          <button
            type="button"
            onClick={() => setDraft((prev) => ({ ...prev, habit_type: 'number' }))}
            className={`rounded-lg border px-3 py-2 text-sm ${draft.habit_type === 'number' ? 'border-red-500 text-white' : 'border-zinc-700 text-zinc-400'}`}
          >
            Number
          </button>
        </div>

        {draft.habit_type === 'number' && (
          <input
            value={draft.unit}
            onChange={(e) => setDraft((prev) => ({ ...prev, unit: e.target.value }))}
            placeholder="Unit (hours, minutes, etc.)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        )}

        <div>
          <p className="text-xs text-zinc-400 mb-2">Weekdays</p>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label, dayIndex) => {
              const active = draft.weekdays.includes(dayIndex);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleWeekday(dayIndex)}
                  className={`rounded-md border px-1 py-2 text-xs ${active ? 'border-red-500 text-white bg-red-600/20' : 'border-zinc-700 text-zinc-400'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!draft.name.trim() || draft.weekdays.length === 0}
          className="w-full rounded-lg bg-red-600 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Save Habit
        </button>
      </div>
    </div>
  );
}

export default function TodayV2Page() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null);
  const [manualActionInput, setManualActionInput] = useState('');
  const [desiredDirection, setDesiredDirection] = useState('');
  const [tomorrowInput, setTomorrowInput] = useState('');
  const [tomorrowActions, setTomorrowActions] = useState([]);
  const [habitEditorValue, setHabitEditorValue] = useState(null);
  const [menuOpenHabitId, setMenuOpenHabitId] = useState(null);

  const todayWeekday = weekdayIndexToday();

  const visibleHabits = useMemo(() => {
    const habits = state?.habits || [];
    return habits.filter((habit) => Array.isArray(habit.weekdays) && habit.weekdays.includes(todayWeekday));
  }, [state?.habits, todayWeekday]);

  const habitValueMap = useMemo(() => {
    const map = new Map();
    for (const log of state?.habitLogs || []) {
      map.set(log.habit_id, log);
    }
    return map;
  }, [state?.habitLogs]);

  const load = React.useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const seedResult = await seedDefaultHabits(user.id);
    if (seedResult.error) {
      console.warn('[TodayV2] seed_default_habits_for_user failed; rendering without seeded defaults', seedResult.error);
    }

    try {
      const next = await loadTodayReviewState(user.id);
      setState(next);
      setDesiredDirection(next.review?.desired_direction || '');
      setTomorrowActions(next.todayPlannedActions.map((a) => a.action_text));
    } catch (loadError) {
      console.error('[TodayV2] load failed:', loadError);
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  const onToggleFollowThrough = async (itemId, completed) => {
    await setFollowThroughCompletion(itemId, completed);
    setState((prev) => ({
      ...prev,
      followThroughItems: prev.followThroughItems.map((item) => (item.id === itemId ? { ...item, completed } : item)),
    }));
  };

  const onAddManualAction = async () => {
    if (!manualActionInput.trim() || !state) return;
    const created = await addManualFollowThroughItem(
      user.id,
      state.today,
      manualActionInput.trim(),
      state.followThroughItems.length
    );
    setState((prev) => ({ ...prev, followThroughItems: [...prev.followThroughItems, created] }));
    setManualActionInput('');
  };

  const onSaveHabit = async (habitDraft) => {
    const habitId = await upsertHabitDefinition(user.id, habitDraft);
    setHabitEditorValue(null);
    setMenuOpenHabitId(null);
    await load();
    return habitId;
  };

  const onDeleteHabit = async (habitId) => {
    await archiveHabit(habitId);
    setMenuOpenHabitId(null);
    await load();
  };

  const onHabitValueChange = async (habit, value) => {
    if (!state) return;
    await upsertHabitLog(user.id, state.today, habit.id, habit.habit_type, value);
    setState((prev) => {
      const others = prev.habitLogs.filter((log) => log.habit_id !== habit.id);
      return {
        ...prev,
        habitLogs: [
          ...others,
          {
            habit_id: habit.id,
            boolean_value: habit.habit_type === 'boolean' ? Boolean(value) : null,
            number_value: habit.habit_type === 'number' && Number.isFinite(value) ? value : null,
          },
        ],
      };
    });
  };

  const onSaveDesiredDirection = async () => {
    if (!state?.review?.id) return;
    await updateDesiredDirection(state.review.id, desiredDirection.trim());
  };

  const onSplitTomorrowActions = () => {
    setTomorrowActions(splitCommitmentIntoTasks(tomorrowInput));
  };

  const onSaveTomorrowActions = async () => {
    if (!state) return;
    await replaceTomorrowActions(user.id, state.today, tomorrowActions);
    await load();
  };

  if (loading) {
    return (
      <AppShellV2 title="Today">
        <div className="h-full flex items-center justify-center text-zinc-400">Loading Today…</div>
      </AppShellV2>
    );
  }

  if (error) {
    return (
      <AppShellV2 title="Today">
        <div className="h-full flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-center space-y-3">
            <h2 className="text-white font-semibold">Couldn’t load Today</h2>
            <p className="text-zinc-400 text-sm">Could not load today&apos;s review. Please try again.</p>
            <button
              type="button"
              onClick={load}
              className="inline-flex rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold"
            >
              Try again
            </button>
          </div>
        </div>
      </AppShellV2>
    );
  }

  if (!state) {
    return (
      <AppShellV2 title="Today">
        <div className="h-full flex items-center justify-center text-zinc-400">Preparing Today…</div>
      </AppShellV2>
    );
  }

  return (
    <AppShellV2 title="Today">
      <div className="h-full overflow-y-auto p-4 space-y-4">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <h2 className="font-semibold">1. Follow-Through</h2>
          {state.followThroughItems.length > 0 ? (
            <div className="space-y-2">
              {state.followThroughItems.map((item) => (
                <label key={item.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 p-3">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={(e) => onToggleFollowThrough(item.id, e.target.checked)}
                  />
                  <span className={item.completed ? 'line-through text-zinc-500' : 'text-zinc-200'}>{item.action_text}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-zinc-400">What were today&apos;s highest-ROI actions?</p>
              <div className="flex gap-2">
                <input
                  value={manualActionInput}
                  onChange={(e) => setManualActionInput(e.target.value)}
                  placeholder="Add action"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
                <button type="button" onClick={onAddManualAction} className="rounded-lg bg-zinc-100 text-zinc-900 px-3 py-2 text-sm">
                  Add
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-3 relative">
          <button
            type="button"
            onClick={() => setHabitEditorValue(EMPTY_HABIT_FORM)}
            className="absolute right-4 top-4 h-7 w-7 rounded-full bg-red-600 text-white border border-red-400 flex items-center justify-center"
            aria-label="Add habit"
          >
            +
          </button>
          <h2 className="font-semibold">2. Habits</h2>
          <div className="space-y-2">
            {visibleHabits.map((habit) => {
              const log = habitValueMap.get(habit.id);
              return (
                <div key={habit.id} className="rounded-xl border border-zinc-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-zinc-200">{habit.name}</p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuOpenHabitId((prev) => (prev === habit.id ? null : habit.id))}
                        className="text-zinc-400 hover:text-white"
                      >
                        ⋯
                      </button>
                      {menuOpenHabitId === habit.id && (
                        <div className="absolute right-0 mt-1 w-24 rounded-lg border border-zinc-700 bg-zinc-950 p-1 z-10">
                          <button type="button" onClick={() => setHabitEditorValue(habit)} className="w-full text-left px-2 py-1 text-xs hover:bg-zinc-800 rounded">Edit</button>
                          <button type="button" onClick={() => onDeleteHabit(habit.id)} className="w-full text-left px-2 py-1 text-xs text-red-400 hover:bg-zinc-800 rounded">Delete</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {habit.habit_type === 'boolean' ? (
                    <label className="mt-2 inline-flex items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={Boolean(log?.boolean_value)}
                        onChange={(e) => onHabitValueChange(habit, e.target.checked)}
                      />
                      Yes
                    </label>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        value={log?.number_value ?? ''}
                        onChange={(e) => onHabitValueChange(habit, e.target.value === '' ? null : Number(e.target.value))}
                        className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-zinc-500">{habit.unit || 'units'}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {visibleHabits.length === 0 && <p className="text-sm text-zinc-500">No habits scheduled for today.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <h2 className="font-semibold">3. Desired Direction</h2>
          <p className="text-xs text-zinc-500">Who am I actively becoming?</p>
          <textarea
            value={desiredDirection}
            onChange={(e) => setDesiredDirection(e.target.value)}
            className="w-full min-h-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <button type="button" onClick={onSaveDesiredDirection} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold">Save direction</button>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <h2 className="font-semibold">4. Highest-ROI Actions</h2>
          <p className="text-xs text-zinc-500">What measured task can I commit to tomorrow that will improve me the most?</p>
          <textarea
            value={tomorrowInput}
            onChange={(e) => setTomorrowInput(e.target.value)}
            className="w-full min-h-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <button type="button" onClick={onSplitTomorrowActions} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">Split into actions</button>
          {tomorrowActions.length > 0 && (
            <ul className="space-y-2">
              {tomorrowActions.map((action, i) => (
                <li key={`${action}-${i}`} className="rounded-lg border border-zinc-800 px-3 py-2 text-sm">{action}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onSaveTomorrowActions} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold">Save tomorrow&apos;s actions</button>
        </section>
      </div>

      {habitEditorValue && (
        <HabitEditorModal
          value={habitEditorValue}
          onClose={() => setHabitEditorValue(null)}
          onSave={onSaveHabit}
        />
      )}
    </AppShellV2>
  );
}
