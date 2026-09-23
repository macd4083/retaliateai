import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Target,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AppShellV2 from '../components/v2/AppShellV2';
import { useAuth } from '../lib/AuthContext';
import { localDateStr } from '../lib/dateUtils';
import { supabase } from '../lib/supabase/client';
import { reflectionHelpers } from '../lib/supabase/reflection';

const COMPLETION_OPTIONS = [
  { key: 'kept', label: 'Yes' },
  { key: 'partial', label: 'Partly' },
  { key: 'missed', label: 'No' },
];

const YES_NO_OPTIONS = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
];

const IDENTITY_OPTIONS = [
  { key: 'yes', label: 'Yes' },
  { key: 'mixed', label: 'Unsure' },
  { key: 'no', label: 'No' },
];

const REQUIRED_FIELD_DETAILS = [
  { key: 'highestRoiAction', label: 'today’s highest-ROI action' },
  { key: 'completionStatus', label: 'whether you completed it' },
  { key: 'resultValue', label: 'the result, value, or honest account of what happened' },
  { key: 'benefitFromAction', label: 'the benefit from action' },
  { key: 'costOfInaction', label: 'the loss or delay from inaction' },
  { key: 'repeatedTrajectory', label: 'where repeated choices would take you' },
  { key: 'becoming', label: 'who today’s evidence suggests you are becoming' },
  { key: 'desiredIdentityFit', label: 'whether that direction is who you want to become' },
  { key: 'lesson', label: 'what today taught you' },
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

function getDraftStorageKey(userId, dateStr) {
  if (!userId || !dateStr) return null;
  return `retaliateai:today-review-draft:${userId}:${dateStr}`;
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

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function createEmptyForm(highestRoiAction = '') {
  return {
    highestRoiAction,
    completionStatus: '',
    resultValue: '',
    sleepHours: '',
    movement: '',
    focusedWorkMinutes: '',
    personalHabitName: '',
    personalHabitDone: '',
    benefitFromAction: '',
    costOfInaction: '',
    repeatedTrajectory: '',
    becoming: '',
    desiredIdentityFit: '',
    lesson: '',
  };
}

function mergeDefined(base, candidate) {
  return Object.keys(base).reduce((accumulator, key) => {
    const nextValue = candidate?.[key];

    if (nextValue === undefined || nextValue === null || nextValue === '') {
      accumulator[key] = base[key];
      return accumulator;
    }

    accumulator[key] = String(nextValue);
    return accumulator;
  }, { ...base });
}

function buildFormFromSession(session, yesterdayCommitment, draft) {
  const storedDetails =
    session?.tomorrow_plan_details && typeof session.tomorrow_plan_details === 'object'
      ? session.tomorrow_plan_details
      : {};
  const review = storedDetails.review_today && typeof storedDetails.review_today === 'object'
    ? storedDetails.review_today
    : {};

  const base = createEmptyForm(yesterdayCommitment || session?.yesterday_commitment || '');
  const persisted = {
    highestRoiAction: review.highest_roi_action || yesterdayCommitment || session?.yesterday_commitment || '',
    completionStatus: session?.checkin_outcome || review.completion_status || '',
    resultValue: review.result_value || '',
    sleepHours: review.sleep_hours ?? '',
    movement: review.movement || '',
    focusedWorkMinutes: review.focused_work_minutes ?? '',
    personalHabitName: review.personal_habit_name || '',
    personalHabitDone: review.personal_habit_done || '',
    benefitFromAction: review.benefit_from_action || '',
    costOfInaction: review.cost_of_inaction || '',
    repeatedTrajectory: review.repeated_trajectory || '',
    becoming: review.becoming || '',
    desiredIdentityFit: review.desired_identity_fit || '',
    lesson: review.lesson || '',
  };

  const withPersisted = mergeDefined(base, persisted);
  return mergeDefined(withPersisted, draft);
}

function sanitizeForm(form) {
  return Object.keys(form).reduce((accumulator, key) => {
    const value = form[key];

    if (typeof value === 'string') {
      accumulator[key] = value.trim();
      return accumulator;
    }

    accumulator[key] = value;
    return accumulator;
  }, {});
}

function buildReviewPayload(form) {
  return {
    highest_roi_action: form.highestRoiAction || null,
    completion_status: form.completionStatus || null,
    result_value: form.resultValue || null,
    sleep_hours: form.sleepHours || null,
    movement: form.movement || null,
    focused_work_minutes: form.focusedWorkMinutes || null,
    personal_habit_name: form.personalHabitName || null,
    personal_habit_done: form.personalHabitDone || null,
    benefit_from_action: form.benefitFromAction || null,
    cost_of_inaction: form.costOfInaction || null,
    repeated_trajectory: form.repeatedTrajectory || null,
    becoming: form.becoming || null,
    desired_identity_fit: form.desiredIdentityFit || null,
    lesson: form.lesson || null,
    submitted_at: new Date().toISOString(),
  };
}

function getMissingRequiredFields(form) {
  return REQUIRED_FIELD_DETAILS.filter(({ key }) => !trimValue(form[key]));
}

function formatMissingFieldList(fields) {
  return fields.map(({ label }) => label).join(', ');
}

function getTextFieldClass(isInvalid) {
  return [
    'mt-3 w-full rounded-2xl border bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2',
    isInvalid
      ? 'border-red-500 focus:border-red-500 focus:ring-red-400'
      : 'border-zinc-700 focus:border-red-500 focus:ring-red-400',
  ].join(' ');
}

function ChoiceGroup({ name, value, options, onChange, columns = 3, invalid = false }) {
  const colClass = columns === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className={`mt-3 grid ${colClass} gap-2 rounded-2xl ${invalid ? 'ring-1 ring-red-500/60 ring-offset-2 ring-offset-zinc-900' : ''}`}>
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(name, option.key)}
            aria-pressed={selected}
            className={[
              'rounded-2xl border px-3 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-900',
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
  );
}

function QuestionBlock({ label, children, hint = null, error = null, required = false }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="block text-sm font-medium text-white">
          {label}
        </label>
        {required && (
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
            Required
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{hint}</p>}
      {children}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

export default function TodayV2() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessionDate, setSessionDate] = useState(localDateStr());
  const [yesterdayPlan, setYesterdayPlan] = useState({ title: '', minimum: '', stretch: '' });
  const [form, setForm] = useState(() => createEmptyForm());
  const [formReady, setFormReady] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [draftState, setDraftState] = useState('idle');
  const [submitState, setSubmitState] = useState('idle');
  const [submitError, setSubmitError] = useState('');
  const [showValidation, setShowValidation] = useState(false);

  const todayLabel = useMemo(() => formatSessionDate(sessionDate), [sessionDate]);
  const draftStorageKey = useMemo(
    () => getDraftStorageKey(user?.id, sessionDate),
    [sessionDate, user?.id]
  );

  const missingRequiredFields = useMemo(() => getMissingRequiredFields(form), [form]);
  const missingRequiredCount = missingRequiredFields.length;
  const missingRequiredSummary = useMemo(
    () => formatMissingFieldList(missingRequiredFields),
    [missingRequiredFields]
  );
  const fieldErrors = useMemo(
    () => new Set(showValidation ? missingRequiredFields.map(({ key }) => key) : []),
    [missingRequiredFields, showValidation]
  );

  const conditionalPrompt = useMemo(() => {
    if (form.completionStatus === 'partial') {
      return 'What progress did it create, and what remains?';
    }

    if (form.completionStatus === 'missed') {
      return 'What was delayed or lost, what interfered, or what did you learn?';
    }

    return 'What tangible result or value did it create?';
  }, [form.completionStatus]);

  const setField = useCallback((field, value) => {
    setFormTouched(true);
    setSubmitError('');
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }, []);

  const loadToday = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setLoadError('');
    setSubmitError('');
    setFormReady(false);
    setFormTouched(false);

    try {
      const session = await reflectionHelpers.getTodaySession(user.id);
      const resolvedDate = session.date || localDateStr();
      const storedDraft = readDraft(getDraftStorageKey(user.id, resolvedDate));

      const { data: yesterday, error } = await supabase
        .from('reflection_sessions')
        .select('tomorrow_commitment, commitment_minimum, commitment_stretch')
        .eq('user_id', user.id)
        .eq('date', offsetDateStr(resolvedDate, -1))
        .maybeSingle();

      if (error) throw error;

      const prefillAction = yesterday?.tomorrow_commitment || '';

      setSessionId(session.id);
      setSessionDate(resolvedDate);
      setYesterdayPlan({
        title: prefillAction,
        minimum: yesterday?.commitment_minimum || '',
        stretch: yesterday?.commitment_stretch || '',
      });
      setForm(buildFormFromSession(session, prefillAction, storedDraft));
      setDraftState(storedDraft ? 'saved' : 'idle');
      setSubmitState('idle');
      setShowValidation(false);
      setFormReady(true);
    } catch (error) {
      console.error('[TodayV2] load failed:', error);
      setLoadError('Could not load today’s review right now. Please try again.');
      setSessionId(null);
      setYesterdayPlan({ title: '', minimum: '', stretch: '' });
      setForm(createEmptyForm());
      setDraftState('idle');
      setSubmitState('idle');
      setShowValidation(false);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (!formReady || !draftStorageKey || !formTouched || submitState === 'success') return;

    const didSave = writeDraft(draftStorageKey, sanitizeForm(form));
    setDraftState(didSave ? 'saved' : 'error');
  }, [draftStorageKey, form, formReady, formTouched, submitState]);

  async function handleSubmitReview() {
    if (!sessionId || submitState === 'saving') return;

    const sanitized = sanitizeForm(form);
    const currentMissingFields = getMissingRequiredFields(sanitized);

    if (currentMissingFields.length > 0) {
      setShowValidation(true);
      setSubmitError(`Please answer: ${formatMissingFieldList(currentMissingFields)}.`);
      return;
    }

    const reviewPayload = buildReviewPayload(sanitized);

    setSubmitState('saving');
    setSubmitError('');
    setShowValidation(false);

    try {
      const session = await reflectionHelpers.getTodaySession(user.id);
      const existingDetails =
        session?.tomorrow_plan_details && typeof session.tomorrow_plan_details === 'object'
          ? session.tomorrow_plan_details
          : {};
      const updates = {
        checkin_outcome: sanitized.completionStatus,
        commitment_checkin_done: Boolean(sanitized.completionStatus),
        tomorrow_plan_details: {
          ...existingDetails,
          workflow: existingDetails.workflow || 'structured_plan_v1',
          review_today: reviewPayload,
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
      setSubmitError('Could not save today’s review. Please try again.');
    }
  }

  if (loading) {
    return (
      <AppShellV2 title="Today">
        <div className="flex h-full items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin text-red-400" />
            Loading today’s review…
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
                    Open reflection chat
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
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Part 1 · Review Today</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{todayLabel}</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                  Action creates evidence. Reflection extracts wisdom. Capture reality first, then plan tomorrow.
                </p>
              </div>
              <div className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-red-300">
                Evidence
              </div>
            </div>

            {yesterdayPlan.title ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-zinc-950/80 p-4">
                <div className="mb-2 flex items-center gap-2 text-red-300">
                  <Target className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-[0.2em]">
                    Yesterday’s planned highest-ROI action
                  </span>
                </div>
                <p className="text-base font-medium leading-relaxed text-white">{yesterdayPlan.title}</p>
                {(yesterdayPlan.minimum || yesterdayPlan.stretch) && (
                  <dl className="mt-4 space-y-2 text-sm text-zinc-300">
                    {yesterdayPlan.minimum && (
                      <div className="flex items-start gap-2">
                        <dt className="min-w-20 text-zinc-500">Minimum</dt>
                        <dd>{yesterdayPlan.minimum}</dd>
                      </div>
                    )}
                    {yesterdayPlan.stretch && (
                      <div className="flex items-start gap-2">
                        <dt className="min-w-20 text-zinc-500">Stretch</dt>
                        <dd>{yesterdayPlan.stretch}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-zinc-700 bg-zinc-950/70 p-4 text-sm text-zinc-300">
                There was no previous-night commitment saved. Think about the action that created—or could
                have created—the most meaningful progress today.
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2 text-zinc-200">
              <CheckCircle2 className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">
                Follow-through and context
              </h3>
            </div>

            <div className="mt-5 space-y-6">
              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <h4 className="text-sm font-semibold text-white">1. Follow-Through</h4>

                <QuestionBlock
                  label="What was today’s highest-ROI action?"
                  hint={!yesterdayPlan.title ? 'Retrospective is valid—capture the action you attempted or should evaluate.' : null}
                  error={fieldErrors.has('highestRoiAction') ? 'Please name the highest-ROI action you are reviewing.' : null}
                  required
                >
                  <textarea
                    id="today-highest-roi-action"
                    value={form.highestRoiAction}
                    onChange={(event) => setField('highestRoiAction', event.target.value)}
                    rows={2}
                    aria-invalid={fieldErrors.has('highestRoiAction')}
                    className={getTextFieldClass(fieldErrors.has('highestRoiAction'))}
                  />
                </QuestionBlock>

                <QuestionBlock
                  label="Did I complete it?"
                  error={fieldErrors.has('completionStatus') ? 'Please choose Yes, Partly, or No.' : null}
                  required
                >
                  <ChoiceGroup
                    name="completionStatus"
                    value={form.completionStatus}
                    options={COMPLETION_OPTIONS}
                    onChange={setField}
                    invalid={fieldErrors.has('completionStatus')}
                  />
                </QuestionBlock>

                <QuestionBlock
                  label={conditionalPrompt}
                  error={fieldErrors.has('resultValue') ? 'Please describe the result, progress, or honest lesson from what happened.' : null}
                  required
                >
                  <textarea
                    id="today-result-value"
                    value={form.resultValue}
                    onChange={(event) => setField('resultValue', event.target.value)}
                    rows={3}
                    aria-invalid={fieldErrors.has('resultValue')}
                    className={getTextFieldClass(fieldErrors.has('resultValue'))}
                  />
                </QuestionBlock>
              </div>

              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <h4 className="text-sm font-semibold text-white">2. Habits</h4>

                <QuestionBlock label="Sleep: ___ hours">
                  <input
                    id="today-sleep-hours"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={form.sleepHours}
                    onChange={(event) => setField('sleepHours', event.target.value)}
                    className={getTextFieldClass(false)}
                  />
                </QuestionBlock>

                <QuestionBlock label="Exercise/movement">
                  <ChoiceGroup
                    name="movement"
                    value={form.movement}
                    options={YES_NO_OPTIONS}
                    onChange={setField}
                    columns={2}
                  />
                </QuestionBlock>

                <QuestionBlock label="Focused work: ___ minutes">
                  <input
                    id="today-focused-work"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={form.focusedWorkMinutes}
                    onChange={(event) => setField('focusedWorkMinutes', event.target.value)}
                    className={getTextFieldClass(false)}
                  />
                </QuestionBlock>

                <QuestionBlock label="Personal habit">
                  <input
                    id="today-personal-habit-name"
                    value={form.personalHabitName}
                    onChange={(event) => setField('personalHabitName', event.target.value)}
                    className={getTextFieldClass(false)}
                  />
                  <ChoiceGroup
                    name="personalHabitDone"
                    value={form.personalHabitDone}
                    options={YES_NO_OPTIONS}
                    onChange={setField}
                    columns={2}
                  />
                </QuestionBlock>
              </div>

              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <h4 className="text-sm font-semibold text-white">3. Consequences and Benefits</h4>

                <QuestionBlock
                  label="What benefit came from the actions I took?"
                  error={fieldErrors.has('benefitFromAction') ? 'Please name the benefit that came from your actions.' : null}
                  required
                >
                  <textarea
                    id="today-benefit-from-action"
                    value={form.benefitFromAction}
                    onChange={(event) => setField('benefitFromAction', event.target.value)}
                    rows={3}
                    aria-invalid={fieldErrors.has('benefitFromAction')}
                    className={getTextFieldClass(fieldErrors.has('benefitFromAction'))}
                  />
                </QuestionBlock>

                <QuestionBlock
                  label="What did I lose or delay through inaction?"
                  error={fieldErrors.has('costOfInaction') ? 'Please name the loss or delay from inaction.' : null}
                  required
                >
                  <textarea
                    id="today-cost-of-inaction"
                    value={form.costOfInaction}
                    onChange={(event) => setField('costOfInaction', event.target.value)}
                    rows={3}
                    aria-invalid={fieldErrors.has('costOfInaction')}
                    className={getTextFieldClass(fieldErrors.has('costOfInaction'))}
                  />
                </QuestionBlock>

                <QuestionBlock
                  label="If I repeated today’s choices, where would they take me?"
                  error={fieldErrors.has('repeatedTrajectory') ? 'Please describe where repeating today’s choices would lead.' : null}
                  required
                >
                  <textarea
                    id="today-repeated-trajectory"
                    value={form.repeatedTrajectory}
                    onChange={(event) => setField('repeatedTrajectory', event.target.value)}
                    rows={3}
                    aria-invalid={fieldErrors.has('repeatedTrajectory')}
                    className={getTextFieldClass(fieldErrors.has('repeatedTrajectory'))}
                  />
                </QuestionBlock>
              </div>

              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <h4 className="text-sm font-semibold text-white">4. Trajectory and Identity</h4>

                <QuestionBlock
                  label="Based on today’s evidence, who am I becoming?"
                  hint="One day is evidence, not a permanent identity verdict."
                  error={fieldErrors.has('becoming') ? 'Please describe who today’s evidence suggests you are becoming.' : null}
                  required
                >
                  <textarea
                    id="today-becoming"
                    value={form.becoming}
                    onChange={(event) => setField('becoming', event.target.value)}
                    rows={3}
                    aria-invalid={fieldErrors.has('becoming')}
                    className={getTextFieldClass(fieldErrors.has('becoming'))}
                  />
                </QuestionBlock>

                <QuestionBlock
                  label="Is that who I want to become?"
                  error={fieldErrors.has('desiredIdentityFit') ? 'Please choose whether that direction matches who you want to become.' : null}
                  required
                >
                  <ChoiceGroup
                    name="desiredIdentityFit"
                    value={form.desiredIdentityFit}
                    options={IDENTITY_OPTIONS}
                    onChange={setField}
                    invalid={fieldErrors.has('desiredIdentityFit')}
                  />
                </QuestionBlock>

                <QuestionBlock
                  label="What did today teach me about myself, my environment, or my methods?"
                  error={fieldErrors.has('lesson') ? 'Please capture what today taught you.' : null}
                  required
                >
                  <textarea
                    id="today-lesson"
                    value={form.lesson}
                    onChange={(event) => setField('lesson', event.target.value)}
                    rows={3}
                    aria-invalid={fieldErrors.has('lesson')}
                    className={getTextFieldClass(fieldErrors.has('lesson'))}
                  />
                </QuestionBlock>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="text-xs leading-relaxed text-zinc-500">
              {showValidation && missingRequiredCount > 0
                ? `Please answer: ${missingRequiredSummary}.`
                : missingRequiredCount > 0
                ? `${missingRequiredCount} required answer${missingRequiredCount === 1 ? '' : 's'} still need evidence before continuing.`
                : 'Review evidence is complete and ready to carry into Plan Tomorrow.'}
            </div>

            <div aria-live="polite" className="mt-3 min-h-6 text-sm">
              {submitState === 'saving' && <span className="text-zinc-400">Saving today’s review…</span>}
              {submitState === 'error' && <span className="text-red-400">{submitError}</span>}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleSubmitReview}
                disabled={!sessionId || submitState === 'saving'}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit Today’s Review &amp; Continue to Plan Tomorrow
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => navigate('/reflection')}
                className="rounded-full border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                Open legacy reflection chat
              </button>
            </div>

            <div className="mt-4 text-xs leading-relaxed text-zinc-500">
              {draftState === 'error'
                ? 'This review draft could not be stored locally right now.'
                : 'Draft edits stay on this device until you submit. Submitted review evidence is saved to your reflection session.'}
            </div>
          </section>
        </div>
      </div>
    </AppShellV2>
  );
}
