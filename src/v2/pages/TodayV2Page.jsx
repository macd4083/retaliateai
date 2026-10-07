import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShellV2 from '../../components/v2/AppShellV2';
import { useAuth } from '../../lib/AuthContext';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import GoogleCalendarConnection from '../components/GoogleCalendarConnection';
import TomorrowScheduler from '../components/TomorrowScheduler';
import { isMissingScheduleSchema } from '../services/scheduling';
import {
  getTodayV2BooleanAnswer,
  getTodayV2CommitmentStateLabel,
  getTodayV2WeekdayDisplayOrder,
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

function HabitEditorModal({ value, onClose, onSave, disabled = false }) {
  const [draft, setDraft] = useState(value);

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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="habit-editor-title" className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
        <div className="flex items-center justify-between">
          <h3 id="habit-editor-title" className="font-semibold text-white">{draft.id ? 'Edit Habit' : 'Add Habit'}</h3>
          <button type="button" aria-label="Close habit editor" onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>

        <input
          disabled={disabled}
          value={draft.name}
          onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
          placeholder="Habit name"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDraft((previous) => ({ ...previous, response_type: TODAY_V2_RESPONSE_TYPES.BOOLEAN, unit: '' }))}
            className={`rounded-lg border px-3 py-2 text-sm ${draft.response_type === TODAY_V2_RESPONSE_TYPES.BOOLEAN ? 'border-red-500 bg-red-600/10 text-white' : 'border-zinc-700 text-zinc-400'}`}
          >
            Yes / No
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDraft((previous) => ({ ...previous, response_type: TODAY_V2_RESPONSE_TYPES.NUMBER }))}
            className={`rounded-lg border px-3 py-2 text-sm ${draft.response_type === TODAY_V2_RESPONSE_TYPES.NUMBER ? 'border-red-500 bg-red-600/10 text-white' : 'border-zinc-700 text-zinc-400'}`}
          >
            Number
          </button>
        </div>

        {draft.response_type === TODAY_V2_RESPONSE_TYPES.NUMBER && (
          <input
            disabled={disabled}
            value={draft.unit}
            onChange={(event) => setDraft((previous) => ({ ...previous, unit: event.target.value }))}
            placeholder="Unit (hours, minutes, etc.)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        )}

        <div>
          <p className="mb-2 text-xs text-zinc-400">Weekdays</p>
          <div className="grid grid-cols-7 gap-1">
            {getTodayV2WeekdayDisplayOrder().map(({ label, weekdayIndex }) => {
              const active = draft.schedule_weekdays.includes(weekdayIndex);
              return (
                <button
                  key={weekdayIndex}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleWeekday(weekdayIndex)}
                  className={`rounded-md border px-1 py-2 text-xs ${active ? 'border-red-500 bg-red-600/20 text-white' : 'border-zinc-700 text-zinc-400'}`}
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
          disabled={disabled || !draft.name.trim() || draft.schedule_weekdays.length === 0}
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
  const navigate = useNavigate();
  const [manualActionInput, setManualActionInput] = useState('');
  const [habitEditorValue, setHabitEditorValue] = useState(null);
  const [menuOpenHabitId, setMenuOpenHabitId] = useState(null);
  const [googleEvents, setGoogleEvents] = useState([]);
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
    try {
      await saveHabitDefinition(habitDraft);
      setHabitEditorValue(null);
      setMenuOpenHabitId(null);
    } catch (saveError) {
      window.alert(saveError?.message || 'Could not save habit.');
    }
  };

  const onDeleteHabit = async (habitId) => {
    if (readOnly) return;
    if (!window.confirm('Delete this habit? Its history will be kept.')) return;
    await archiveHabitDefinition(habitId);
    setMenuOpenHabitId(null);
  };

  const onCompleteReview = async () => {
    if (readOnly) return;
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

        {ENABLE_TODAY_V2_SCHEDULER && (
          <GoogleCalendarConnection
            userId={user?.id}
            localDate={state.tomorrowLocalDate}
            timezone={state.timezoneName}
            includeNextDay
            onEvents={setGoogleEvents}
          />
        )}

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
            onUpdate={updateSchedule}
            onUnschedule={unschedule}
            onRetry={load}
          />
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
                disabled={!completionGate.canComplete || completionSaving}
                onClick={onCompleteReview}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {completionSaving ? 'Completing…' : 'Complete tonight\'s review'}
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
