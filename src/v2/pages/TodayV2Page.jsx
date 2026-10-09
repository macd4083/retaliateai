import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import AppShellV2 from '../../components/v2/AppShellV2';
import { useAuth } from '../../lib/AuthContext';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import GoogleCalendarConnection from '../components/GoogleCalendarConnection';
import TomorrowScheduler from '../components/TomorrowScheduler';
import HabitWeekPlanner from '../components/HabitWeekPlanner';
import { isMissingScheduleSchema } from '../services/scheduling';
import {
  getTodayV2BooleanAnswer,
  getTodayV2CommitmentStateLabel,
} from '../today/model';
import { useTodayV2State } from '../today/useTodayV2State';
import {
  TODAY_V2_COMMITMENT_STATES,
  TODAY_V2_RESPONSE_TYPES,
} from '../today/types';

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

function NumericHabitResponseInput({ occurrence, onSave, disabled = false }) {
  const [draftValue, setDraftValue] = React.useState(occurrence.numeric_response ?? '');

  React.useEffect(() => {
    setDraftValue(occurrence.numeric_response ?? '');
  }, [occurrence.id, occurrence.numeric_response]);

  const commit = () => {
    if (disabled) return;
    onSave(draftValue === '' ? null : Number(draftValue));
  };

  return (
    <input
      type="number"
      disabled={disabled}
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

export function HabitEditorModal({ value, onClose, onSave, disabled = false }) {
  const [draft, setDraft] = useState(() => ({
    ...value,
    name: value.name || '',
    unit: value.unit || '',
    response_type: value.response_type || TODAY_V2_RESPONSE_TYPES.BOOLEAN,
    schedule_weekdays: Array.isArray(value.schedule_weekdays) ? value.schedule_weekdays : [0, 1, 2, 3, 4, 5, 6],
    planning_mode: value.planning_mode === 'automatic' ? 'automatic' : 'manual',
    schedule_times: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, {
      time: value.schedule_times?.[day]?.time || '',
      duration_minutes: value.schedule_times?.[day]?.duration_minutes ?? 30,
      occurrence: value.schedule_times?.[day]?.occurrence === 'later' ? 'later' : 'earlier',
    }])),
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const locked = disabled || saving;
  const isValidEntry = (entry) => /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)
    && Number.isInteger(entry.duration_minutes) && entry.duration_minutes >= 1 && entry.duration_minutes <= 1440;
  const invalidSchedule = draft.schedule_weekdays.some((day) => {
    const entry = draft.schedule_times[day];
    return !Number.isInteger(entry.duration_minutes) || entry.duration_minutes < 1 || entry.duration_minutes > 1440
      || ((draft.planning_mode === 'automatic' || entry.time !== '') && !isValidEntry(entry));
  });
  const save = async () => {
    if (locked || invalidSchedule || !draft.name.trim() || !draft.schedule_weekdays.length) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...draft,
        schedule_times: Object.fromEntries(Object.entries(draft.schedule_times).filter(([, entry]) => isValidEntry(entry))),
      });
    } catch (failure) {
      setSaveError(failure?.message || 'Could not save habit.');
    } finally {
      setSaving(false);
    }
  };

  const toggleWeekday = (dayIndex) => {
    setDraft((previous) => {
      const hasDay = previous.schedule_weekdays.includes(dayIndex);
      const scheduleWeekdays = hasDay
        ? previous.schedule_weekdays.filter((entry) => entry !== dayIndex)
        : [...previous.schedule_weekdays, dayIndex].sort((left, right) => left - right);
      return { ...previous, schedule_weekdays: scheduleWeekdays };
    });
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-4 text-white">
        <div className="flex items-center justify-between">
          <Dialog.Title className="font-semibold text-white">{draft.id ? 'Edit Habit' : 'Add Habit'}</Dialog.Title>
          <button type="button" disabled={saving} aria-label="Close habit editor" onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <Dialog.Description className="text-sm text-zinc-400">Set your habit, weekly days, and how it enters your calendar.</Dialog.Description>

        <input
          aria-label="Habit name"
          disabled={locked}
          value={draft.name}
          onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
          placeholder="Habit name"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={locked}
            aria-pressed={draft.response_type === TODAY_V2_RESPONSE_TYPES.BOOLEAN}
            onClick={() => setDraft((previous) => ({ ...previous, response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN, unit: '' }))}
            className={`rounded-lg border px-3 py-2 text-sm ${draft.response_type === TODAY_V2_RESPONSE_TYPES.BOOLEAN ? 'border-red-500 bg-red-600/10 text-white' : 'border-zinc-700 text-zinc-400'}`}
          >
            Yes / No
          </button>
          <button
            type="button"
            disabled={locked}
            aria-pressed={draft.response_type === TODAY_V2_RESPONSE_TYPES.NUMBER}
            onClick={() => setDraft((previous) => ({ ...previous, response_type: TODAY_V2_RESPONSE_TYPES.NUMBER }))}
            className={`rounded-lg border px-3 py-2 text-sm ${draft.response_type === TODAY_V2_RESPONSE_TYPES.NUMBER ? 'border-red-500 bg-red-600/10 text-white' : 'border-zinc-700 text-zinc-400'}`}
          >
            Number
          </button>
        </div>

        {draft.response_type === TODAY_V2_RESPONSE_TYPES.NUMBER && (
          <input
            aria-label="Habit unit"
            disabled={locked}
            value={draft.unit}
            onChange={(event) => setDraft((previous) => ({ ...previous, unit: event.target.value }))}
            placeholder="Unit (hours, minutes, etc.)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        )}

        <fieldset disabled={locked} className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Calendar planning</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="habit-planning-mode" value="manual" checked={draft.planning_mode === 'manual'} onChange={() => setDraft((previous) => ({ ...previous, planning_mode: 'manual' }))} />
            <span>Manual<span className="block text-xs text-zinc-400">Available to plan in your daily workflow. Times are optional preferences, not automatic bookings.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="habit-planning-mode" value="automatic" checked={draft.planning_mode === 'automatic'} onChange={() => setDraft((previous) => ({ ...previous, planning_mode: 'automatic' }))} />
            <span>Automatic<span className="block text-xs text-zinc-400">Consistently preplanned on selected days at the prescribed times. Each selected day needs a time and duration.</span></span>
          </label>
        </fieldset>
        <HabitWeekPlanner
          name={draft.name}
          weekdays={draft.schedule_weekdays}
          times={draft.schedule_times}
          disabled={locked}
          onToggleDay={toggleWeekday}
          onChangeTime={(day, changes) => setDraft((previous) => ({
            ...previous,
            schedule_times: { ...previous.schedule_times, [day]: { ...previous.schedule_times[day], ...changes } },
          }))}
        />
        {invalidSchedule && <p role="alert" className="text-sm text-amber-300">Set a valid time and a whole-minute duration from 1 to 1440 for each timed day. Automatic planning requires a time on every selected day.</p>}
        {saveError && <p role="alert" className="text-sm text-red-300">{saveError}</p>}

        <button
          type="button"
          onClick={save}
          disabled={locked || invalidSchedule || !draft.name.trim() || draft.schedule_weekdays.length === 0}
          className="w-full rounded-lg bg-red-600 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Habit'}
        </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function TodayV2Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [manualActionInput, setManualActionInput] = useState('');
  const [habitEditorValue, setHabitEditorValue] = useState(null);
  const [menuOpenHabitId, setMenuOpenHabitId] = useState(null);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleControls, setGoogleControls] = useState(null);
  const [googleWriting, setGoogleWriting] = useState(false);
  const googleWritingRef = React.useRef(false);
  const onGoogleWritePending = React.useCallback((pending) => {
    googleWritingRef.current = pending;
    setGoogleWriting(pending);
  }, []);
  const {
    loading,
    error,
    state,
    seedDiagnostic,
    desiredDirection,
    setDesiredDirection,
    tomorrowInput,
    setTomorrowInput,
    tomorrowActions,
    tomorrowActionItems,
    editTomorrowAction,
    removeTomorrowAction,
    schedulerItems,
    scheduleBlocks,
    scheduleSaveStatus,
    scheduleError,
    scheduleAvailable,
    scheduleDiagnostic,
    updateSchedule,
    unschedule,
    firstFiveMinutes,
    setFirstFiveMinutes,
    visibleHabits,
    habitDefinitionsById,
    load,
    splitTomorrowActions,
    saveTomorrowPlan,
    saveCommitmentCompletion,
    saveDesiredDirection,
    saveHabitDefinition,
    archiveHabitDefinition,
    saveHabitResponse,
    addManualFollowThrough,
    completeReview,
    reopenReview,
    completionGate,
    completionSaving,
    desiredDirectionSaveLabel,
    tomorrowPlanSaveLabel,
    firstFiveMinutesSaveLabel,
    tomorrowPlanError,
    isCompleted,
    createEmptyHabitDefinition,
  } = useTodayV2State(user?.id);

  const readOnly = isCompleted || completionSaving;
  const savedDesiredDirection = state?.review?.desired_direction || state?.previousDesiredDirection || '';

  const onAddManualAction = async () => {
    if (!manualActionInput.trim() || readOnly) return;
    await addManualFollowThrough(manualActionInput.trim());
    setManualActionInput('');
  };

  const onSaveHabit = async (habitDraft) => {
    if (readOnly) return;
    await saveHabitDefinition(habitDraft);
    setHabitEditorValue(null);
    setMenuOpenHabitId(null);
  };

  const onDeleteHabit = async (habitId) => {
    if (readOnly) return;
    if (!window.confirm('Delete this habit? Its history will be kept.')) return;
    await archiveHabitDefinition(habitId);
    setMenuOpenHabitId(null);
  };

  const onCompleteReview = async () => {
    if (readOnly || googleWritingRef.current) return;
    try {
      const savedReview = await completeReview();
      if (savedReview?.completed_at) navigate('/home');
    } catch (saveError) {
      window.alert(saveError?.message || 'Could not complete tonight\'s review.');
    }
  };

  const onReopenReview = async () => {
    if (completionSaving) return;
    try {
      await reopenReview();
    } catch (saveError) {
      window.alert(saveError?.message || 'Could not reopen tonight\'s review.');
    }
  };

  if (loading) {
    return (
      <AppShellV2 title="Review & Plan">
        <div className="flex h-full items-center justify-center text-zinc-400">Loading Today…</div>
      </AppShellV2>
    );
  }

  if (error) {
    return (
      <AppShellV2 title="Review & Plan">
        <div className="flex h-full items-center justify-center p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-center">
            <h2 className="font-semibold text-white">Couldn’t load Review &amp; Plan</h2>
            <p className="text-sm text-zinc-400">Could not load today&apos;s review. Please try again.</p>
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
      <AppShellV2 title="Review & Plan">
        <div className="flex h-full items-center justify-center text-zinc-400">Preparing Today…</div>
      </AppShellV2>
    );
  }

  return (
    <AppShellV2 title="Review & Plan">
      <div className="h-full space-y-4 overflow-y-auto p-4">
        {seedDiagnostic && (
          <section className="rounded-2xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-100">
            <p className="font-medium">Default habits weren’t initialized automatically.</p>
            <p className="mt-1 text-amber-200/80">{seedDiagnostic.message}</p>
          </section>
        )}

        {isCompleted && (
          <section className="rounded-2xl border border-emerald-700/60 bg-emerald-950/20 p-4 text-sm text-emerald-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">Tonight&apos;s review is complete.</p>
                <p className="mt-1 text-emerald-200/80">Your answers are locked in until you choose to edit them again.</p>
              </div>
              <button
                type="button"
                onClick={onReopenReview}
                disabled={completionSaving}
                className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-100"
              >
                Edit
              </button>
            </div>
          </section>
        )}

        <h2 className="pt-2 text-lg font-semibold text-white">Part 1: Review Today</h2>
        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="font-semibold">1. Follow-Through</h3>
          {state.followThroughItems.length > 0 ? (
            <div className="space-y-2">
              {state.followThroughItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-zinc-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-zinc-200">{item.normalized_fragment_text || item.fragment_text}</p>
                    <span className="text-xs text-zinc-500">{getTodayV2CommitmentStateLabel(item.completion_state)}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <SegmentedChoice
                      disabled={readOnly}
                      value={item.completion_state}
                      onChange={(nextValue) => saveCommitmentCompletion(item.id, nextValue || TODAY_V2_COMMITMENT_STATES.UNANSWERED)}
                      options={[
                        { value: TODAY_V2_COMMITMENT_STATES.KEPT, label: 'Kept', allowToggleOff: true },
                        { value: TODAY_V2_COMMITMENT_STATES.NOT_KEPT, label: 'Not kept', allowToggleOff: true },
                      ]}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => saveCommitmentCompletion(item.id, TODAY_V2_COMMITMENT_STATES.UNANSWERED)}
                        className="text-xs text-zinc-500 hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-zinc-400">What were today&apos;s highest-ROI actions?</p>}
          {!readOnly && (
            <div className="flex gap-2">
              <input
                value={manualActionInput}
                onChange={(event) => setManualActionInput(event.target.value)}
                placeholder="Add action"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <button type="button" onClick={onAddManualAction} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
                Add
              </button>
            </div>
          )}
        </section>

        <section className="relative space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          {!readOnly && (
            <button
              type="button"
              onClick={() => setHabitEditorValue(createEmptyHabitDefinition())}
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-red-400 bg-red-600 text-white"
              aria-label="Add habit"
            >
              +
            </button>
          )}
          <h3 className="font-semibold">2. Habits</h3>
          <div className="space-y-2">
            {visibleHabits.map((occurrence) => {
              const habitDefinition = habitDefinitionsById.get(occurrence.habit_definition_id) || occurrence;
              const booleanAnswer = getTodayV2BooleanAnswer(occurrence.boolean_response, occurrence.answered_at);
              return (
                <div key={occurrence.id} className="rounded-xl border border-zinc-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-zinc-200">{occurrence.snapshot_name}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {occurrence.snapshot_response_type === TODAY_V2_RESPONSE_TYPES.NUMBER
                          ? occurrence.snapshot_unit || 'units'
                          : 'Answer yes or no'}
                      </p>
                    </div>
                    {!readOnly && (
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={`Habit options for ${occurrence.snapshot_name}`}
                          onClick={() => setMenuOpenHabitId((current) => current === habitDefinition.id ? null : habitDefinition.id)}
                          className="text-zinc-400 hover:text-white"
                        >
                          ⋯
                        </button>
                        {menuOpenHabitId === habitDefinition.id && (
                          <div className="absolute right-0 z-10 mt-1 w-24 rounded-lg border border-zinc-700 bg-zinc-950 p-1">
                            <button type="button" onClick={() => setHabitEditorValue(habitDefinition)} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-800">Edit</button>
                            <button type="button" onClick={() => onDeleteHabit(habitDefinition.id)} className="w-full rounded px-2 py-1 text-left text-xs text-red-400 hover:bg-zinc-800">Delete</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {occurrence.snapshot_response_type === TODAY_V2_RESPONSE_TYPES.BOOLEAN ? (
                    <div className="mt-3 flex items-center gap-2">
                      <SegmentedChoice
                        disabled={readOnly}
                        value={booleanAnswer}
                        onChange={(nextValue) => saveHabitResponse(occurrence, nextValue === null ? null : nextValue === 'yes')}
                        options={[
                          { value: 'yes', label: 'Yes', allowToggleOff: true },
                          { value: 'no', label: 'No', allowToggleOff: true },
                        ]}
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => saveHabitResponse(occurrence, null)}
                          className="text-xs text-zinc-500 hover:text-white"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <NumericHabitResponseInput disabled={readOnly} occurrence={occurrence} onSave={(value) => saveHabitResponse(occurrence, value)} />
                      <span className="text-xs text-zinc-500">{occurrence.snapshot_unit || 'units'}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {!readOnly && state.habitDefinitions.length < 4 && (
              <button
                type="button"
                onClick={() => setHabitEditorValue({
                  ...createEmptyHabitDefinition(),
                  response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN,
                })}
                className="w-full rounded-xl border border-dashed border-zinc-700 p-3 text-left text-sm text-zinc-300 hover:border-zinc-500"
              >
                Add your personal habit (Yes/No)
              </button>
            )}
            {visibleHabits.length === 0 && <p className="text-sm text-zinc-500">No habits scheduled for today.</p>}
          </div>
        </section>

        <h2 className="pt-2 text-lg font-semibold text-white">Part 2: Plan Tomorrow</h2>
        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="font-semibold">5.1 Desired Direction</h3>
          <p className="text-xs text-zinc-500">Who are you becoming, or what are you changing about yourself?</p>
          <textarea
            value={desiredDirection}
            readOnly={readOnly}
            disabled={completionSaving}
            placeholder={state.previousDesiredDirection || ''}
            onChange={(event) => setDesiredDirection(event.target.value)}
            onBlur={() => { if (!readOnly) void saveDesiredDirection(); }}
            className="min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm read-only:cursor-not-allowed read-only:opacity-70"
          />
          <div className="flex items-center gap-3">
            <p className="text-xs text-zinc-500">{desiredDirectionSaveLabel}</p>
            <button
              type="button"
              disabled={readOnly || !savedDesiredDirection}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDesiredDirection(savedDesiredDirection);
                void saveDesiredDirection();
              }}
              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Autofill
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="font-semibold">6.1 Identity Alignment</h3>
          <p className="text-xs text-zinc-500">What actions will align me the most with who I&apos;m becoming?</p>
          <textarea
            value={tomorrowInput}
            readOnly={readOnly}
            onChange={(event) => setTomorrowInput(event.target.value)}
            onBlur={() => { if (!readOnly) void saveTomorrowPlan(); }}
            className="min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm read-only:cursor-not-allowed read-only:opacity-70"
          />
          {!readOnly && <button type="button" onClick={splitTomorrowActions} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">Refresh split</button>}
          {tomorrowActions.length > 0 && (
            <ul className="space-y-2">
              {tomorrowActions.map((action, index) => (
                <li key={tomorrowActionItems?.[index]?.id || index} className="flex items-center gap-2 rounded-lg border border-zinc-800 p-2 text-sm">
                  {index === 0 && <span className="text-xs font-semibold text-red-300">Primary</span>}
                  <input
                    readOnly={readOnly}
                    value={action}
                    aria-label={`Tomorrow action ${index + 1}`}
                    onChange={(event) => editTomorrowAction(index, event.target.value)}
                    className="flex-1 bg-transparent outline-none read-only:cursor-not-allowed read-only:opacity-70"
                  />
                  {!isCompleted && (
                    <button
                      type="button"
                      onClick={() => removeTomorrowAction(index)}
                      className="text-xs text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">{tomorrowPlanSaveLabel}</p>
              {!readOnly && <button type="button" onClick={saveTomorrowPlan} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold">Save tomorrow&apos;s actions</button>}
            </div>
            {tomorrowPlanError && <p className="text-xs text-amber-300">{tomorrowPlanError}</p>}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="font-semibold">6.2 Start focus</h3>
          <p className="text-xs text-zinc-500">What will the start of each action look like?</p>
          <p className="text-xs text-zinc-500">List each start on a separate line, in the same order as your actions.</p>
          <textarea
            value={firstFiveMinutes}
            readOnly={readOnly}
            onChange={(event) => setFirstFiveMinutes(event.target.value)}
            onBlur={() => { if (!readOnly) void saveTomorrowPlan(); }}
            className="min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm read-only:cursor-not-allowed read-only:opacity-70"
          />
          <p className="text-xs text-zinc-500">{firstFiveMinutesSaveLabel}</p>
        </section>

        {ENABLE_TODAY_V2_SCHEDULER && (
          <div className="space-y-3">
          <GoogleCalendarConnection
            userId={user?.id}
            localDate={state.tomorrowLocalDate}
            timezone={state.timezoneName}
            includeNextDay
            onEvents={setGoogleEvents}
            onControls={setGoogleControls}
            onWritePending={onGoogleWritePending}
            readOnly={readOnly}
            completionSaving={completionSaving}
          />
          <TomorrowScheduler
            userId={user?.id}
            localDate={state.tomorrowLocalDate}
            timezone={state.timezoneName}
            items={schedulerItems}
            blocks={(scheduleBlocks || []).map((block) => {
              const sourceId = block.source_id || block.commitment_fragment_id || block.habit_definition_id;
              const action = (state.tomorrowFragments || []).find((item) => item.id === sourceId);
              const habit = (state.habitOccurrences || []).find((item) => item.habit_definition_id === sourceId);
              return { ...block, label: block.label || (action ? action.normalized_fragment_text || action.fragment_text : habit?.snapshot_name) };
            })}
            contextBlocks={(state.todaySchedules || []).map((block) => {
              const sourceId = block.source_id || block.commitment_fragment_id || block.habit_definition_id;
              const action = state.followThroughItems.find((item) => item.id === sourceId);
              const habit = (state.habitOccurrences || []).find((item) => item.habit_definition_id === sourceId);
              return { ...block, label: action ? action.normalized_fragment_text || action.fragment_text : habit?.snapshot_name || 'Previous-day plan' };
            })}
            available={scheduleAvailable}
            availabilityError={isMissingScheduleSchema(scheduleDiagnostic)
              ? 'Calendar database setup is incomplete. Apply the Today V2 scheduling migrations in order through 20261009_today_v2_completion_release_guard.sql, then retry scheduling.'
              : scheduleDiagnostic?.message}
            readOnly={readOnly}
            saveStatus={scheduleSaveStatus}
            saveError={scheduleError}
            googleEvents={googleEvents}
            onGoogleEdit={googleControls?.edit}
            onGoogleUpdate={googleControls?.update}
            onUpdate={updateSchedule}
            onUnschedule={unschedule}
            onRetry={load}
          />
          </div>
        )}

        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Complete tonight&apos;s review</h2>
              <p className="mt-1 text-xs text-zinc-500">Lock in tonight&apos;s reflection and move into the Proof screen.</p>
            </div>
            {!readOnly && (
              <button
                type="button"
                disabled={!completionGate.canComplete || completionSaving || googleWriting}
                onClick={onCompleteReview}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {completionSaving ? 'Completing…' : googleWriting ? 'Saving Google event…' : 'Complete tonight\'s review'}
              </button>
            )}
          </div>
          {!completionGate.followThroughSatisfied && (
            <p className="text-xs text-amber-300">Answer every Follow-Through item before you complete tonight&apos;s review.</p>
          )}
          {!completionGate.hasTomorrowActions && (
            <p className="text-xs text-amber-300">Plan at least one action for tomorrow before you complete tonight&apos;s review.</p>
          )}
          {completionGate.unansweredHabitsCount > 0 && (
            <p className="text-xs text-zinc-500">Soft warning: {completionGate.unansweredHabitsCount} habit {completionGate.unansweredHabitsCount === 1 ? 'is' : 'are'} still unanswered.</p>
          )}
          {completionGate.hasSoftFirstFiveMinutesWarning && (
            <p className="text-xs text-zinc-500">Soft reminder: 6.2 is empty.</p>
          )}
        </section>
      </div>

      {habitEditorValue && (
        <HabitEditorModal
          value={habitEditorValue}
          disabled={readOnly}
          onClose={() => setHabitEditorValue(null)}
          onSave={onSaveHabit}
        />
      )}
    </AppShellV2>
  );
}
