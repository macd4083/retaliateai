import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  Moon,
  Target,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AppShellV2 from '../components/v2/AppShellV2';
import { useAuth } from '../lib/AuthContext';
import { localDateStr } from '../lib/dateUtils';
import { reflectionHelpers } from '../lib/supabase/reflection';

function formatSessionDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
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
    desiredDirection: '',
    valueToStrengthen: '',
    primaryAction: '',
    completionDefinition: '',
    additionalActions: '',
    startPlan: '',
    obstacle: '',
    fallbackAction: '',
    tonightPreparation: '',
  };
}

function getDraftStorageKey(userId, dateStr) {
  if (!userId || !dateStr) return null;
  return `retaliateai:plan-draft:${userId}:${dateStr}`;
}

function readDraft(storageKey) {
  if (!storageKey || typeof window === 'undefined') return null;

  try {
    const rawDraft = window.localStorage.getItem(storageKey);
    return rawDraft ? JSON.parse(rawDraft) : null;
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

function mergeDefined(base, candidate) {
  return Object.keys(base).reduce((accumulator, key) => {
    const nextValue = candidate?.[key];

    if (
      nextValue === undefined ||
      nextValue === null ||
      nextValue === ''
    ) {
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
  const plan = storedDetails.plan_tomorrow && typeof storedDetails.plan_tomorrow === 'object'
    ? storedDetails.plan_tomorrow
    : {};

  const combinedCommitmentWhy = typeof session?.commitment_why === 'string'
    ? session.commitment_why
    : '';
  const whyParts = combinedCommitmentWhy.split(' | ');

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
    desiredDirection: plan.desired_direction || whyParts[0] || '',
    valueToStrengthen: plan.value_to_strengthen || whyParts[1] || '',
    primaryAction: session?.tomorrow_commitment || plan.primary_action || '',
    completionDefinition: session?.commitment_minimum || plan.completion_definition || '',
    additionalActions: session?.commitment_stretch || plan.additional_actions || '',
    startPlan: plan.start_plan || storedDetails.when_where || '',
    obstacle: plan.obstacle || '',
    fallbackAction: plan.minimum_action_if_blocked || '',
    tonightPreparation: plan.tonight_preparation || '',
  };

  const withPersistedValues = mergeDefined(base, persisted);
  return mergeDefined(withPersistedValues, draft);
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

function buildPublishedPayload(form) {
  return {
    workflow: 'structured_plan_v1',
    what: form.primaryAction,
    when_where: form.startPlan,
    success_criteria: form.completionDefinition,
    additional_actions: form.additionalActions || null,
    review_today: {
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
    },
    plan_tomorrow: {
      desired_direction: form.desiredDirection || null,
      value_to_strengthen: form.valueToStrengthen || null,
      primary_action: form.primaryAction || null,
      completion_definition: form.completionDefinition || null,
      additional_actions: form.additionalActions || null,
      start_plan: form.startPlan || null,
      obstacle: form.obstacle || null,
      minimum_action_if_blocked: form.fallbackAction || null,
      tonight_preparation: form.tonightPreparation || null,
    },
    published_at: new Date().toISOString(),
  };
}

function QuestionBlock({ label, children, hint = null }) {
  return (
    <div>
      <label className="block text-sm font-medium text-white">
        {label}
      </label>
      {hint && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{hint}</p>}
      {children}
    </div>
  );
}

export default function PlanV2() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessionDate, setSessionDate] = useState(localDateStr());
  const [existingCommitment, setExistingCommitment] = useState('');
  const [form, setForm] = useState(() => createEmptyForm());
  const [draftState, setDraftState] = useState('idle');
  const [formReady, setFormReady] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [publishState, setPublishState] = useState('idle');
  const [publishError, setPublishError] = useState('');
  const [publishedAt, setPublishedAt] = useState('');

  const formattedDate = useMemo(() => formatSessionDate(sessionDate), [sessionDate]);
  const draftStorageKey = useMemo(
    () => getDraftStorageKey(user?.id, sessionDate),
    [sessionDate, user?.id]
  );

  const missingRequiredFields = useMemo(() => {
    const requiredValues = [
      form.desiredDirection,
      form.valueToStrengthen,
      form.primaryAction,
      form.completionDefinition,
      form.startPlan,
      form.obstacle,
      form.fallbackAction,
      form.tonightPreparation,
    ];

    return requiredValues.filter((value) => !trimValue(value)).length;
  }, [form]);

  const canPublish = missingRequiredFields === 0 && confirmChecked && publishState !== 'saving';
  const hasReviewEvidence = Boolean(
    trimValue(form.highestRoiAction) ||
      trimValue(form.repeatedTrajectory) ||
      trimValue(form.lesson)
  );

  const setField = useCallback((field, value) => {
    setFormTouched(true);
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }, []);

  const loadWorksheet = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setLoadError('');
    setPublishError('');
    setFormReady(false);
    setFormTouched(false);

    try {
      const session = await reflectionHelpers.getTodaySession(user.id);
      const date = session.date || localDateStr();
      const priorCommitment = session.yesterday_commitment || await reflectionHelpers.getYesterdayCommitment(user.id) || '';
      const storedDraft = readDraft(getDraftStorageKey(user.id, date));
      const restoredForm = buildFormFromSession(session, priorCommitment, storedDraft);
      const storedPublishedAt =
        session?.tomorrow_plan_details &&
        typeof session.tomorrow_plan_details === 'object' &&
        typeof session.tomorrow_plan_details.published_at === 'string'
          ? session.tomorrow_plan_details.published_at
          : '';

      setSessionId(session.id);
      setSessionDate(date);
      setExistingCommitment(session.tomorrow_commitment || '');
      setForm(restoredForm);
      setPublishedAt(storedPublishedAt);
      setDraftState(storedDraft ? 'saved' : 'idle');
      setFormReady(true);
    } catch (error) {
      console.error('[PlanV2] load failed:', error);
      setLoadError('Could not load tonight’s worksheet right now. Please try again.');
      setSessionId(null);
      setExistingCommitment('');
      setPublishedAt('');
      setDraftState('idle');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadWorksheet();
  }, [loadWorksheet]);

  useEffect(() => {
    if (!formReady || !draftStorageKey || !formTouched || publishState === 'success') return;

    const didSave = writeDraft(draftStorageKey, sanitizeForm(form));
    setDraftState(didSave ? 'saved' : 'error');
  }, [draftStorageKey, form, formReady, formTouched, publishState]);

  async function handlePublish() {
    if (!sessionId || !canPublish) return;

    const sanitizedForm = sanitizeForm(form);
    const payload = buildPublishedPayload(sanitizedForm);
    const updates = {
      tomorrow_commitment: sanitizedForm.primaryAction,
      commitment_minimum: sanitizedForm.completionDefinition,
      commitment_stretch: sanitizedForm.additionalActions || null,
      commitment_why: [sanitizedForm.desiredDirection, sanitizedForm.valueToStrengthen]
        .filter(Boolean)
        .join(' | ') || null,
      tomorrow_plan_details: payload,
      commitment_checkin_done: Boolean(sanitizedForm.completionStatus),
      checkin_outcome: sanitizedForm.completionStatus || null,
    };

    if (!existingCommitment) {
      updates.commitment_made_at = new Date().toISOString();
    }

    setPublishState('saving');
    setPublishError('');

    try {
      const updatedSession = await reflectionHelpers.updateSession(sessionId, updates);
      const nextPublishedAt =
        updatedSession?.tomorrow_plan_details &&
        typeof updatedSession.tomorrow_plan_details === 'object' &&
        typeof updatedSession.tomorrow_plan_details.published_at === 'string'
          ? updatedSession.tomorrow_plan_details.published_at
          : payload.published_at;

      setExistingCommitment(updatedSession?.tomorrow_commitment || sanitizedForm.primaryAction);
      setPublishedAt(nextPublishedAt);
      setPublishState('success');
      setConfirmChecked(false);
      clearDraft(draftStorageKey);
      setDraftState('idle');
    } catch (error) {
      console.error('[PlanV2] publish failed:', error);
      setPublishState('error');
      setPublishError('Could not publish tomorrow’s action. Please try again.');
    }
  }

  if (loading) {
    return (
      <AppShellV2 title="Plan">
        <div className="flex h-full items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin text-red-400" />
            Loading tonight’s worksheet…
          </div>
        </div>
      </AppShellV2>
    );
  }

  if (loadError) {
    return (
      <AppShellV2 title="Plan">
        <div className="flex h-full items-center justify-center px-4">
          <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-zinc-900 p-5 shadow-lg shadow-black/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-red-400" />
              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Couldn’t load the worksheet</h2>
                  <p className="mt-1 text-sm text-zinc-300">{loadError}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={loadWorksheet}
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
    <AppShellV2 title="Plan">
      <div className="h-full overflow-y-auto px-4 pb-8 pt-5">
        <div className="mx-auto max-w-xl space-y-5">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg shadow-black/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Nightly worksheet</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{formattedDate}</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                  Review today first. Then decide tomorrow from evidence instead of mood.
                </p>
              </div>
              <div className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-red-300">
                Structured
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-medium uppercase tracking-[0.18em]">
              {['1 Review Today', '2 Plan Tomorrow', '3 Confirm'].map((step, index) => (
                <div
                  key={step}
                  className={[
                    'rounded-2xl border px-3 py-2 text-center',
                    index === 1
                      ? 'border-red-500/40 bg-red-500/10 text-red-200'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-500',
                  ].join(' ')}
                >
                  {step}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Review context</p>
                <h3 className="mt-1 text-base font-semibold text-white">
                  Evidence carried from Today
                </h3>
              </div>
              <button
                type="button"
                onClick={() => navigate('/today')}
                className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                Back to Review Today
              </button>
            </div>

            {hasReviewEvidence ? (
              <dl className="mt-4 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-300">
                <div>
                  <dt className="text-zinc-500">Highest-ROI action reviewed</dt>
                  <dd>{trimValue(form.highestRoiAction) || 'Not provided'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Repeated-choice trajectory</dt>
                  <dd>{trimValue(form.repeatedTrajectory) || 'Not provided'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Lesson from today</dt>
                  <dd>{trimValue(form.lesson) || 'Not provided'}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 rounded-2xl border border-zinc-700 bg-zinc-950/70 p-4 text-sm text-zinc-300">
                Complete Today’s Review first so planning starts from your own evidence.
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2 text-zinc-200">
              <Target className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">
                Part 2 · Plan Tomorrow
              </h3>
            </div>

            <div className="mt-5 space-y-6">
              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <h4 className="text-sm font-semibold text-white">5. Desired Direction</h4>

                <QuestionBlock label="Who do I want to become through tomorrow’s choices?">
                  <textarea
                    id="plan-desired-direction"
                    value={form.desiredDirection}
                    onChange={(event) => setField('desiredDirection', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>

                <QuestionBlock label="What value or capability do I want to strengthen?">
                  <textarea
                    id="plan-value-to-strengthen"
                    value={form.valueToStrengthen}
                    onChange={(event) => setField('valueToStrengthen', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>
              </div>

              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <h4 className="text-sm font-semibold text-white">6. Highest-ROI Actions</h4>

                <QuestionBlock label="What is tomorrow’s single highest-ROI action?">
                  <textarea
                    id="plan-primary-action"
                    value={form.primaryAction}
                    onChange={(event) => setField('primaryAction', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>

                <QuestionBlock label="What tangible result will define completion?">
                  <textarea
                    id="plan-completion-definition"
                    value={form.completionDefinition}
                    onChange={(event) => setField('completionDefinition', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>

                <QuestionBlock label="If capacity remains, what are the next one or two highest-ROI actions?">
                  <textarea
                    id="plan-additional-actions"
                    value={form.additionalActions}
                    onChange={(event) => setField('additionalActions', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>
              </div>

              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <h4 className="text-sm font-semibold text-white">7. Execution Plan</h4>

                <QuestionBlock label="When and where will I begin the primary action?">
                  <textarea
                    id="plan-start-plan"
                    value={form.startPlan}
                    onChange={(event) => setField('startPlan', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>

                <QuestionBlock label="What obstacle could prevent it?">
                  <textarea
                    id="plan-obstacle"
                    value={form.obstacle}
                    onChange={(event) => setField('obstacle', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>

                <QuestionBlock label="If that obstacle appears, what minimum action will I still take?">
                  <textarea
                    id="plan-fallback-action"
                    value={form.fallbackAction}
                    onChange={(event) => setField('fallbackAction', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>

                <QuestionBlock label="What will I change or prepare tonight to make follow-through easier?">
                  <textarea
                    id="plan-tonight-preparation"
                    value={form.tonightPreparation}
                    onChange={(event) => setField('tonightPreparation', event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </QuestionBlock>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2 text-zinc-200">
              <Moon className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">
                Part 3 · Final confirmation
              </h3>
            </div>

            <div className="mt-4 rounded-2xl border border-red-500/20 bg-zinc-950/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-red-300">
                Tomorrow’s action
              </p>
              <p className="mt-2 text-base font-medium leading-relaxed text-white">
                {trimValue(form.primaryAction) || 'Add tomorrow’s primary action above.'}
              </p>
              <dl className="mt-4 space-y-3 text-sm text-zinc-300">
                <div>
                  <dt className="text-zinc-500">Completion</dt>
                  <dd>{trimValue(form.completionDefinition) || 'Not filled yet.'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Start</dt>
                  <dd>{trimValue(form.startPlan) || 'Not filled yet.'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Direction</dt>
                  <dd>{trimValue(form.desiredDirection) || 'Not filled yet.'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Minimum backup action</dt>
                  <dd>{trimValue(form.fallbackAction) || 'Not filled yet.'}</dd>
                </div>
              </dl>
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
              <input
                id="plan-confirm-checkbox"
                type="checkbox"
                checked={confirmChecked}
                onChange={(event) => setConfirmChecked(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-red-500 focus:ring-red-400"
              />
              <span className="text-sm leading-relaxed text-zinc-300">
                I want this published as tomorrow’s action, with the review above kept as evidence for why it matters.
              </span>
            </label>

            <div className="mt-3 text-xs leading-relaxed text-zinc-500">
              {missingRequiredFields > 0
                ? `${missingRequiredFields} required answer${missingRequiredFields === 1 ? '' : 's'} still missing before you can publish.`
                : 'Ready to publish. Tomorrow will carry the primary action, completion standard, and extra actions forward into Today.'}
            </div>

            <div aria-live="polite" className="mt-3 min-h-6 text-sm">
              {publishState === 'saving' && <span className="text-zinc-400">Publishing tomorrow’s action…</span>}
              {publishState === 'success' && (
                <span className="text-emerald-400">
                  Tomorrow’s action is published. It will carry into Today on the next day.
                </span>
              )}
              {publishState === 'error' && <span className="text-red-400">{publishError}</span>}
            </div>

            {publishedAt && (
              <div className="mt-2 text-xs text-zinc-500">
                Last published {new Date(publishedAt).toLocaleString()}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handlePublish}
                disabled={!canPublish}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Publish tomorrow’s action
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/reflection')}
                className="rounded-full border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                Open classic reflection chat
              </button>
            </div>

            <div className="mt-4 text-xs leading-relaxed text-zinc-500">
              {draftState === 'error'
                ? 'This worksheet draft could not be stored locally right now.'
                : 'Draft edits stay on this device until you publish. The published plan is saved to your reflection session.'}
            </div>
          </section>
        </div>
      </div>
    </AppShellV2>
  );
}
