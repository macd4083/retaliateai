import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, MoreHorizontal, Plus, Target, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AppShellV2 from '../components/v2/AppShellV2';
import { useAuth } from '../lib/AuthContext';
import { buildCommitmentFragmentsFromLegacyFields, formatCommitmentFragmentText } from '../lib/commitmentFragments';
import { localDateStr } from '../lib/dateUtils';
import { dailyWorkflow } from '../lib/supabase/dailyWorkflow';
import { reflectionHelpers } from '../lib/supabase/reflection';

const OUTCOME_OPTIONS = [
  { key: 'done', label: 'Done' },
  { key: 'partial', label: 'Partial' },
  { key: 'missed', label: 'Missed' },
];

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'Th' },
  { value: 5, label: 'F' },
  { value: 6, label: 'Sa' },
  { value: 0, label: 'Su' },
];

const HABIT_INPUT_OPTIONS = [
  { value: 'boolean', label: 'Yes / No' },
  { value: 'number', label: 'Number' },
  { value: 'duration', label: 'Duration' },
];

const MAX_RETROSPECTIVE_ACTIONS = 3;

function formatSessionDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function getDraftStorageKey(userId, dateStr) {
  if (!userId || !dateStr) return null;
  return `retaliateai:today-review-v3-draft:${userId}:${dateStr}`;
}

function readDraft(storageKey) {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function writeDraft(storageKey, value) {
  if (!storageKey || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch (_error) {
    return false;
  }
}

function clearDraft(storageKey) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch (_error) {
    // noop
  }
}

function createActionRow(base = {}) {
  return {
    id: base.id || `local-${Math.random().toString(36).slice(2)}`,
    plan_action_id: base.plan_action_id || base.id || null,
    action_text: base.action_text || '',
    completion_measure: base.completion_measure || '',
    is_primary: Boolean(base.is_primary),
    outcome: base.outcome || '',
  };
}

function mergePlanAndReviewRows(planRows, reviewRows) {
  if (!planRows.length) return reviewRows;
  if (!reviewRows.length) return planRows;

  const reviewByPlanId = new Map(
    reviewRows
      .filter((row) => row.plan_action_id)
      .map((row) => [row.plan_action_id, row])
  );
  const unmatchedReviews = [...reviewRows];

  const merged = planRows.map((planRow) => {
    const byPlanId = planRow.plan_action_id ? reviewByPlanId.get(planRow.plan_action_id) : null;
    const match = byPlanId || null;
    if (!match) return planRow;

    const removeIndex = unmatchedReviews.findIndex((item) => item.id === match.id);
    if (removeIndex >= 0) unmatchedReviews.splice(removeIndex, 1);

    return {
      ...planRow,
      action_text: match.action_text || planRow.action_text,
      completion_measure: match.completion_measure || planRow.completion_measure,
      outcome: match.outcome || planRow.outcome,
      is_primary: planRow.is_primary || match.is_primary,
    };
  });

  return [...merged, ...unmatchedReviews];
}

function createHabitValues(habits, checkins) {
  const byHabit = new Map((checkins || []).map((item) => [item.habit_id, item]));
  return habits.reduce((acc, habit) => {
    const existing = byHabit.get(habit.id);
    acc[habit.id] = {
      value_boolean: existing?.value_boolean ?? null,
      value_number: existing?.value_number ?? '',
    };
    return acc;
  }, {});
}

function normalizeActionsForValidation(rows) {
  return rows
    .map((row) => ({ ...row, action_text: row.action_text.trim(), completion_measure: row.completion_measure.trim() }))
    .filter((row) => row.action_text.length > 0 || row.outcome.length > 0);
}

function actionRowError(row) {
  const textMissing = !row.action_text.trim();
  const statusMissing = !row.outcome;
  if (!textMissing && !statusMissing) return '';
  if (textMissing && statusMissing) return 'Action and outcome are required.';
  if (textMissing) return 'Action text is required.';
  return 'Select Done, Partial, or Missed.';
}

function HabitModal({ open, onClose, onSave, initialValue, saveError, saving }) {
  const [form, setForm] = useState(() => initialValue);

  useEffect(() => {
    setForm(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (!open) return;
    const handler = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, saving]);

  if (!open) return null;

  const selectedDays = new Set(form.scheduled_days);
  const nameError = !form.name.trim();
  const dayError = form.scheduled_days.length === 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-modal-title"
        className="w-full max-w-md rounded-3xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="habit-modal-title" className="text-lg font-semibold text-white">
              {form.id ? 'Edit habit' : 'Add habit'}
            </h3>
            <p className="mt-1 text-sm text-zinc-400">Choose a name, input type, and schedule.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-400"
            aria-label="Close habit dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="habit-name" className="text-sm font-medium text-white">Habit name</label>
            <input
              id="habit-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className={`mt-2 w-full rounded-xl border bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400 ${nameError ? 'border-red-500' : 'border-zinc-700'}`}
            />
          </div>

          <div>
            <label htmlFor="habit-input-type" className="text-sm font-medium text-white">Input type</label>
            <select
              id="habit-input-type"
              value={form.input_type}
              onChange={(event) => setForm((current) => ({ ...current, input_type: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              {HABIT_INPUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="habit-unit" className="text-sm font-medium text-white">Unit (optional)</label>
            <input
              id="habit-unit"
              value={form.unit}
              onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
              placeholder={form.input_type === 'duration' ? 'minutes' : form.input_type === 'number' ? 'hours' : ''}
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-white">Schedule</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAY_OPTIONS.map((day) => {
                const selected = selectedDays.has(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => {
                      setForm((current) => {
                        const next = new Set(current.scheduled_days);
                        if (next.has(day.value)) next.delete(day.value);
                        else next.add(day.value);
                        return { ...current, scheduled_days: Array.from(next) };
                      });
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-400 ${selected ? 'border-red-500 bg-red-500/10 text-white' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}
                    aria-pressed={selected}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        {(nameError || dayError || saveError) && (
          <p className="mt-4 text-sm text-red-300">
            {saveError || (nameError ? 'Habit name is required.' : 'Select at least one scheduled day.')}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || nameError || dayError}
            onClick={() => onSave({ ...form, name: form.name.trim(), unit: form.unit.trim() })}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TodayV2() {
  const auth = /** @type {{ user?: { id?: string } }} */ (useAuth());
  const user = auth?.user;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessionDate, setSessionDate] = useState(localDateStr());
  const [hasPreviousPlan, setHasPreviousPlan] = useState(false);
  const [actions, setActions] = useState([]);
  const [habits, setHabits] = useState([]);
  const [habitValues, setHabitValues] = useState({});
  const [menuHabitId, setMenuHabitId] = useState(null);

  const [submitState, setSubmitState] = useState('idle');
  const [submitError, setSubmitError] = useState('');
  const [draftState, setDraftState] = useState('idle');
  const [formTouched, setFormTouched] = useState(false);

  const [habitModalOpen, setHabitModalOpen] = useState(false);
  const [habitModalSaving, setHabitModalSaving] = useState(false);
  const [habitModalError, setHabitModalError] = useState('');
  const [editingHabit, setEditingHabit] = useState(null);

  const todayLabel = useMemo(() => formatSessionDate(sessionDate), [sessionDate]);
  const draftStorageKey = useMemo(() => getDraftStorageKey(user?.id, sessionDate), [sessionDate, user?.id]);

  const actionErrors = useMemo(() => actions.map((row) => actionRowError(row)), [actions]);
  const canAddRetrospective = !hasPreviousPlan && actions.length < MAX_RETROSPECTIVE_ACTIONS;

  const loadData = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setLoadError('');
    setSubmitError('');

    try {
      const session = await reflectionHelpers.getTodaySession(user.id);
      const date = session.date || localDateStr();
      const draft = readDraft(getDraftStorageKey(user.id, date));
      const context = await dailyWorkflow.loadReviewData(user.id, date);

      const fromPlanRows = (context.planActions || []).map((row) => createActionRow(row));
      const fromReviewRows = (context.actionReviews || []).map((row) => createActionRow(row));
      const fromLegacyRows = buildCommitmentFragmentsFromLegacyFields({
        tomorrowCommitment: context.yesterdayCommitment,
        commitmentMinimum: context.yesterdayCommitmentMinimum,
        commitmentStretch: context.yesterdayCommitmentStretch,
      }).map((fragment, index) => createActionRow({
        action_text: formatCommitmentFragmentText(fragment),
        is_primary: index === 0,
      }));
      const planWithReviews = mergePlanAndReviewRows(fromPlanRows, fromReviewRows);
      const seededRows = planWithReviews.length
        ? planWithReviews
        : fromLegacyRows.length
        ? fromLegacyRows
        : [];

      let nextActions;
      if (draft?.actions?.length) {
        nextActions = draft.actions.map((row) => createActionRow(row));
      } else {
        nextActions = seededRows;
      }

      const nextHabitValues = draft?.habitValues
        ? draft.habitValues
        : createHabitValues(context.habits, context.checkins);

      setSessionId(session.id);
      setSessionDate(date);
      setHasPreviousPlan(seededRows.length > 0);
      setActions(nextActions);
      setHabits(context.habits || []);
      setHabitValues(nextHabitValues);
      setDraftState(draft ? 'saved' : 'idle');
      setFormTouched(false);
      setSubmitState('idle');
    } catch (error) {
      console.error('[TodayV2] load failed:', error);
      setLoadError('Could not load today’s review. Please try again.');
      setActions([]);
      setHabits([]);
      setHabitValues({});
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!draftStorageKey || !formTouched || submitState === 'success') return;
    const didSave = writeDraft(draftStorageKey, { actions, habitValues });
    setDraftState(didSave ? 'saved' : 'error');
  }, [actions, draftStorageKey, formTouched, habitValues, submitState]);

  const setActionField = (index, key, value) => {
    setFormTouched(true);
    setSubmitError('');
    setActions((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  };

  const addRetrospectiveAction = () => {
    setFormTouched(true);
    setActions((current) => [...current, createActionRow({ is_primary: current.length === 0 })]);
  };

  const setHabitValue = (habitId, patch) => {
    setFormTouched(true);
    setSubmitError('');
    setHabitValues((current) => ({
      ...current,
      [habitId]: {
        value_boolean: current[habitId]?.value_boolean ?? null,
        value_number: current[habitId]?.value_number ?? '',
        ...patch,
      },
    }));
  };

  const openAddHabitModal = () => {
    setEditingHabit(null);
    setHabitModalError('');
    setHabitModalOpen(true);
  };

  const openEditHabitModal = (habit) => {
    setEditingHabit(habit);
    setHabitModalError('');
    setHabitModalOpen(true);
    setMenuHabitId(null);
  };

  const handleSaveHabit = async (habitInput) => {
    if (!user?.id) return;

    setHabitModalSaving(true);
    setHabitModalError('');

    try {
      const nextOrder = editingHabit ? editingHabit.display_order : habits.length;
      const saved = await dailyWorkflow.saveHabit(user.id, {
        ...habitInput,
        id: editingHabit?.id || null,
        display_order: nextOrder,
      });
      await loadData();
      setHabitModalOpen(false);
      setEditingHabit(null);
      setHabitValues((current) => ({
        ...current,
        [saved.id]: current[saved.id] || { value_boolean: null, value_number: '' },
      }));
    } catch (error) {
      console.error('[TodayV2] save habit failed:', error);
      setHabitModalError('Could not save habit. Please try again.');
    } finally {
      setHabitModalSaving(false);
    }
  };

  const handleArchiveHabit = async (habit) => {
    if (!user?.id) return;
    setMenuHabitId(null);

    const confirmed = window.confirm(`Delete "${habit.name}"? Existing check-ins stay in your history.`);
    if (!confirmed) return;

    try {
      await dailyWorkflow.archiveHabit(user.id, habit.id);
      await loadData();
    } catch (error) {
      console.error('[TodayV2] archive habit failed:', error);
      setSubmitError('Could not delete habit. Please try again.');
    }
  };

  const handleSubmit = async () => {
    if (!user?.id || !sessionId || submitState === 'saving') return;

    const normalized = normalizeActionsForValidation(actions);

    if (!normalized.length) {
      setSubmitError('Add at least one important action before continuing.');
      return;
    }

    const firstInvalid = normalized.find((row) => !row.action_text || !row.outcome);
    if (firstInvalid) {
      setSubmitError('Each action needs text plus Done, Partial, or Missed before continuing.');
      return;
    }

    const reviewsPayload = normalized.map((row, index) => ({ ...row, is_primary: index === 0 || row.is_primary }));
    const habitRows = habits.map((habit) => {
      const value = habitValues[habit.id] || {};
      const value_boolean = habit.input_type === 'boolean' ? value.value_boolean : null;
      const hasNumber = value.value_number !== '' && value.value_number !== null && value.value_number !== undefined;
      const value_number = habit.input_type !== 'boolean' && hasNumber ? Number(value.value_number) : null;
      return {
        habit_id: habit.id,
        value_boolean,
        value_number: Number.isFinite(value_number) ? value_number : null,
      };
    });

    setSubmitState('saving');
    setSubmitError('');

    try {
      await dailyWorkflow.saveActionReviews({
        userId: user.id,
        sessionId,
        reviewDate: sessionDate,
        rows: reviewsPayload,
      });

      await dailyWorkflow.saveHabitCheckins({
        userId: user.id,
        reviewDate: sessionDate,
        rows: habitRows,
      });

      const primaryReviewedAction = reviewsPayload.find((row) => row.is_primary) || reviewsPayload[0];
      const primaryOutcome = primaryReviewedAction?.outcome || null;
      const mappedCheckinOutcome = primaryOutcome === 'done' ? 'kept' : primaryOutcome;

      const session = await reflectionHelpers.getTodaySession(user.id);
      const details = session?.tomorrow_plan_details && typeof session.tomorrow_plan_details === 'object'
        ? session.tomorrow_plan_details
        : {};

      const updates = {
        checkin_outcome: mappedCheckinOutcome,
        commitment_checkin_done: Boolean(mappedCheckinOutcome),
        tomorrow_plan_details: {
          ...details,
          workflow: 'review_today_plan_tomorrow_v2',
          review_today: {
            action_count: reviewsPayload.length,
            reviewed_at: new Date().toISOString(),
          },
        },
      };

      await reflectionHelpers.updateSession(sessionId, updates);

      setSubmitState('success');
      clearDraft(draftStorageKey);
      setDraftState('idle');
      navigate('/plan');
    } catch (error) {
      console.error('[TodayV2] submit failed:', error);
      setSubmitState('error');
      setSubmitError('Could not save today’s review. Your entries are still here. Please retry.');
    }
  };

  if (loading) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin text-red-400" />
            Loading Review Today…
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
                <button
                  type="button"
                  onClick={loadData}
                  className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppShellV2>
    );
  }

  return (
    <AppShellV2 title="Today">
      <HabitModal
        open={habitModalOpen}
        saving={habitModalSaving}
        saveError={habitModalError}
        onClose={() => {
          if (habitModalSaving) return;
          setHabitModalOpen(false);
          setEditingHabit(null);
          setHabitModalError('');
        }}
        onSave={handleSaveHabit}
        initialValue={editingHabit ? {
          id: editingHabit.id,
          name: editingHabit.name,
          input_type: editingHabit.input_type,
          unit: editingHabit.unit || '',
          scheduled_days: editingHabit.scheduled_days || [],
        } : {
          id: null,
          name: '',
          input_type: 'boolean',
          unit: '',
          scheduled_days: [1, 2, 3, 4, 5],
        }}
      />

      <div className="h-full overflow-y-auto px-4 pb-8 pt-5">
        <div className="mx-auto max-w-xl space-y-5">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg shadow-black/20">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Review Today</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{todayLabel}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              Action creates evidence. Reflection extracts wisdom. Wisdom improves direction.
            </p>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2 text-zinc-200">
              <CheckCircle2 className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">1. Follow-through</h3>
            </div>

            {hasPreviousPlan ? (
              <p className="mt-3 text-sm text-zinc-300">
                Review yesterday’s planned actions as separate rows. Primary is first.
              </p>
            ) : (
              <p className="mt-3 rounded-2xl border border-zinc-700 bg-zinc-950/70 p-3 text-sm text-zinc-300">
                What were today’s highest-ROI actions? Add up to {MAX_RETROSPECTIVE_ACTIONS} rows and score each one.
              </p>
            )}

            <div className="mt-4 space-y-3">
              {actions.map((row, index) => (
                <div key={row.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    {(hasPreviousPlan || row.action_text.trim() || row.completion_measure.trim() || row.outcome) ? (
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                        {index === 0 || row.is_primary ? 'Primary action' : 'Secondary action'}
                      </div>
                    ) : <div />}
                    {row.completion_measure && <span className="text-xs text-zinc-400">Measure: {row.completion_measure}</span>}
                  </div>

                  <textarea
                    id={`today-action-text-${index}`}
                    value={row.action_text}
                    onChange={(event) => setActionField(index, 'action_text', event.target.value)}
                    rows={2}
                    placeholder="Action text"
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                  />

                  <input
                    id={`today-action-measure-${index}`}
                    value={row.completion_measure}
                    onChange={(event) => setActionField(index, 'completion_measure', event.target.value)}
                    placeholder="Optional measure or minimum context"
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                  />

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {OUTCOME_OPTIONS.map((option) => {
                      const selected = row.outcome === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setActionField(index, 'outcome', option.key)}
                          aria-pressed={selected}
                          className={`rounded-xl border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-400 ${selected ? 'border-red-500 bg-red-500/10 text-white' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>

                  {actionErrors[index] && <p className="mt-2 text-xs text-red-300">{actionErrors[index]}</p>}
                </div>
              ))}
            </div>

            {canAddRetrospective && (
              <button
                type="button"
                onClick={addRetrospectiveAction}
                className="mt-3 rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400"
              >
                Add action
              </button>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">2. Habits</h3>
              <button
                type="button"
                onClick={openAddHabitModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                aria-label="Add habit"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {habits.map((habit) => {
                const habitValue = habitValues[habit.id] || { value_boolean: null, value_number: '' };
                return (
                  <div key={habit.id} className="relative rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{habit.name}</p>
                        {habit.unit && <p className="mt-0.5 text-xs text-zinc-500">Unit: {habit.unit}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setMenuHabitId((current) => (current === habit.id ? null : habit.id))}
                        className="rounded-lg border border-zinc-700 p-1.5 text-zinc-300 hover:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                        aria-haspopup="menu"
                        aria-expanded={menuHabitId === habit.id}
                        aria-label={`Open actions for ${habit.name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>

                    {habit.input_type === 'boolean' ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[
                          { label: 'Yes', value: true },
                          { label: 'No', value: false },
                        ].map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => setHabitValue(habit.id, { value_boolean: option.value })}
                            aria-pressed={habitValue.value_boolean === option.value}
                            className={`rounded-xl border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-400 ${habitValue.value_boolean === option.value ? 'border-red-500 bg-red-500/10 text-white' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        id={`habit-value-${habit.id}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={habitValue.value_number}
                        onChange={(event) => setHabitValue(habit.id, { value_number: event.target.value })}
                        className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                      />
                    )}

                    {menuHabitId === habit.id && (
                      <div
                        role="menu"
                        className="absolute right-3 top-11 z-20 w-32 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openEditHabitModal(habit)}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => handleArchiveHabit(habit)}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-zinc-800"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="text-xs text-zinc-500">
              Save all outcomes and habit evidence, then continue to plan tomorrow.
            </div>

            <div aria-live="polite" className="mt-3 min-h-6 text-sm">
              {submitState === 'saving' && <span className="text-zinc-400">Saving review…</span>}
              {submitError && <span className="text-red-400">{submitError}</span>}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!sessionId || submitState === 'saving'}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save review and plan tomorrow
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 text-xs leading-relaxed text-zinc-500">
              {draftState === 'error'
                ? 'Draft could not be saved locally right now.'
                : 'Draft entries stay on this device until the save succeeds.'}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-500">
            <div className="flex items-start gap-2">
              <Target className="mt-0.5 h-4 w-4 text-red-400" />
              <p>
                Today is now evidence-focused. Consequences and trajectory prompts are reserved for future weekly review.
              </p>
            </div>
          </section>
        </div>
      </div>
    </AppShellV2>
  );
}
