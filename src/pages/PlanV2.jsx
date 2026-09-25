import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, Moon, Plus, Target } from 'lucide-react';

import AppShellV2 from '../components/v2/AppShellV2';
import { useAuth } from '../lib/AuthContext';
import { localDateStr } from '../lib/dateUtils';
import { dailyWorkflow, offsetDateStr } from '../lib/supabase/dailyWorkflow';
import { reflectionHelpers } from '../lib/supabase/reflection';

const MAX_ADDITIONAL_ACTIONS = 2;

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
  return `retaliateai:plan-v3-draft:${userId}:${dateStr}`;
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
    action_text: base.action_text || '',
    completion_measure: base.completion_measure || '',
    minimum_version: base.minimum_version || '',
    stretch_version: base.stretch_version || '',
    is_primary: Boolean(base.is_primary),
  };
}

function buildDraftFromSession(session, tomorrowDate, localDraft) {
  const details = session?.tomorrow_plan_details && typeof session.tomorrow_plan_details === 'object'
    ? session.tomorrow_plan_details
    : {};

  const persistedDraft = details.plan_tomorrow_draft && typeof details.plan_tomorrow_draft === 'object'
    ? details.plan_tomorrow_draft
    : {};

  const publishedPlan = details.plan_tomorrow && typeof details.plan_tomorrow === 'object'
    ? details.plan_tomorrow
    : {};

  return {
    desiredDirection:
      localDraft?.desiredDirection
      || persistedDraft.desired_direction
      || publishedPlan.desired_direction
      || '',
    actions: (localDraft?.actions || persistedDraft.actions || publishedPlan.actions || []).map((row) => createActionRow(row)),
    planDate: tomorrowDate,
  };
}

function sanitizeAction(row) {
  return {
    ...row,
    action_text: row.action_text.trim(),
    completion_measure: row.completion_measure.trim(),
    minimum_version: row.minimum_version.trim(),
    stretch_version: row.stretch_version.trim(),
  };
}

function actionError(row, isPrimary) {
  if (!row.action_text && !row.completion_measure && !row.minimum_version && !row.stretch_version) {
    return isPrimary ? 'Primary action is required.' : '';
  }
  if (!row.action_text) return 'Action text is required.';
  if (!row.completion_measure) return 'Completion measure is required.';
  if (isPrimary && !row.minimum_version) return 'Primary minimum version is required.';
  return '';
}

function looksVague(actionText) {
  const text = actionText.trim().toLowerCase();
  if (!text) return false;
  const hasNumber = /\d/.test(text);
  const hasConcreteVerb = /(send|write|call|ship|build|review|test|draft|publish|exercise|train|prepare|finish)/.test(text);
  return !(hasNumber || hasConcreteVerb);
}

export default function PlanV2() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessionDate, setSessionDate] = useState(localDateStr());
  const [tomorrowDate, setTomorrowDate] = useState(localDateStr(1));
  const [desiredDirection, setDesiredDirection] = useState('');
  const [actions, setActions] = useState([createActionRow({ is_primary: true })]);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [draftState, setDraftState] = useState('idle');
  const [saveDraftState, setSaveDraftState] = useState('idle');
  const [publishState, setPublishState] = useState('idle');
  const [publishError, setPublishError] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [formTouched, setFormTouched] = useState(false);

  const formattedDate = useMemo(() => formatSessionDate(sessionDate), [sessionDate]);
  const draftStorageKey = useMemo(() => getDraftStorageKey(user?.id, sessionDate), [sessionDate, user?.id]);

  const sanitizedActions = useMemo(() => actions.map((row) => sanitizeAction(row)), [actions]);
  const actionErrors = useMemo(() => sanitizedActions.map((row, index) => actionError(row, index === 0)), [sanitizedActions]);
  const primaryAction = sanitizedActions[0] || createActionRow({ is_primary: true });
  const additionalActions = sanitizedActions.slice(1).filter((row) => row.action_text || row.completion_measure || row.minimum_version || row.stretch_version);

  const canAddAdditional = actions.length <= MAX_ADDITIONAL_ACTIONS;
  const hasFieldErrors = !desiredDirection.trim() || actionErrors.some(Boolean) || !sanitizedActions[0]?.action_text;
  const canPublish = !hasFieldErrors && confirmChecked && publishState !== 'saving';

  const loadData = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setLoadError('');
    setPublishError('');

    try {
      const session = await reflectionHelpers.getTodaySession(user.id);
      const date = session.date || localDateStr();
      const planDate = offsetDateStr(date, 1);
      const localDraft = readDraft(getDraftStorageKey(user.id, date));
      const fromSession = buildDraftFromSession(session, planDate, localDraft);
      const existingActions = await dailyWorkflow.loadTomorrowPlanActions(user.id, planDate);

      const nextActions = localDraft?.actions?.length
        ? localDraft.actions.map((row, index) => createActionRow({ ...row, is_primary: index === 0 }))
        : fromSession.actions.length
        ? fromSession.actions.map((row, index) => createActionRow({ ...row, is_primary: index === 0 }))
        : existingActions.length
        ? existingActions.map((row, index) => createActionRow({ ...row, is_primary: index === 0 }))
        : [createActionRow({ is_primary: true })];

      const details = session?.tomorrow_plan_details && typeof session.tomorrow_plan_details === 'object'
        ? session.tomorrow_plan_details
        : {};

      setSessionId(session.id);
      setSessionDate(date);
      setTomorrowDate(planDate);
      setDesiredDirection(fromSession.desiredDirection || '');
      setActions(nextActions);
      setPublishedAt(typeof details.published_at === 'string' ? details.published_at : '');
      setDraftState(localDraft ? 'saved' : 'idle');
      setSaveDraftState('idle');
      setPublishState('idle');
      setFormTouched(false);
    } catch (error) {
      console.error('[PlanV2] load failed:', error);
      setLoadError('Could not load plan tomorrow. Please try again.');
      setActions([createActionRow({ is_primary: true })]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!draftStorageKey || !formTouched || publishState === 'success') return;
    const didSave = writeDraft(draftStorageKey, { desiredDirection, actions });
    setDraftState(didSave ? 'saved' : 'error');
  }, [actions, desiredDirection, draftStorageKey, formTouched, publishState]);

  const setActionField = (index, field, value) => {
    setFormTouched(true);
    setPublishError('');
    setActions((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const addAdditionalAction = () => {
    if (!canAddAdditional) return;
    setFormTouched(true);
    setActions((current) => [...current, createActionRow({ is_primary: false })]);
  };

  const removeAdditionalAction = (index) => {
    setFormTouched(true);
    setActions((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const applyMeasurableHint = (index) => {
    setFormTouched(true);
    setActions((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index || row.completion_measure.trim()) return row;
      return {
        ...row,
        completion_measure: 'Define success as a count, duration, or completed deliverable.',
      };
    }));
  };

  const saveDraftToSession = async () => {
    if (!sessionId || !user?.id || saveDraftState === 'saving') return;

    const cleanDesiredDirection = desiredDirection.trim();
    const cleanActions = sanitizedActions;

    setSaveDraftState('saving');
    setPublishError('');

    try {
      const session = await reflectionHelpers.getTodaySession(user.id);
      const existingDetails = session?.tomorrow_plan_details && typeof session.tomorrow_plan_details === 'object'
        ? session.tomorrow_plan_details
        : {};

      await reflectionHelpers.updateSession(sessionId, {
        tomorrow_plan_details: {
          ...existingDetails,
          workflow: 'review_today_plan_tomorrow_v2',
          plan_tomorrow_draft: {
            desired_direction: cleanDesiredDirection || null,
            actions: cleanActions,
            updated_at: new Date().toISOString(),
          },
        },
      });
      setSaveDraftState('success');
    } catch (error) {
      console.error('[PlanV2] save draft failed:', error);
      setSaveDraftState('error');
      setPublishError('Could not save draft right now.');
    }
  };

  const handlePublish = async () => {
    if (!sessionId || !user?.id || !canPublish) return;

    const cleanDesiredDirection = desiredDirection.trim();
    const publishRows = sanitizedActions
      .filter((row, index) => index === 0 || row.action_text || row.completion_measure || row.minimum_version || row.stretch_version)
      .map((row, index) => ({ ...row, is_primary: index === 0 }));

    setPublishState('saving');
    setPublishError('');

    try {
      const insertedRows = await dailyWorkflow.publishTomorrowPlan({
        userId: user.id,
        sessionId,
        planDate: tomorrowDate,
        actions: publishRows,
      });

      const session = await reflectionHelpers.getTodaySession(user.id);
      const existingDetails = session?.tomorrow_plan_details && typeof session.tomorrow_plan_details === 'object'
        ? session.tomorrow_plan_details
        : {};

      const publishedPayload = {
        desired_direction: cleanDesiredDirection,
        actions: publishRows,
        plan_date: tomorrowDate,
      };

      const publishedAtIso = new Date().toISOString();

      await reflectionHelpers.updateSession(sessionId, {
        tomorrow_commitment: publishRows[0].action_text,
        commitment_minimum: publishRows[0].minimum_version || publishRows[0].completion_measure,
        commitment_stretch: publishRows[0].stretch_version || null,
        commitment_why: cleanDesiredDirection || null,
        commitment_made_at: new Date().toISOString(),
        tomorrow_plan_details: {
          ...existingDetails,
          workflow: 'review_today_plan_tomorrow_v2',
          plan_tomorrow_draft: {
            desired_direction: cleanDesiredDirection,
            actions: publishRows,
            updated_at: publishedAtIso,
          },
          plan_tomorrow: publishedPayload,
          published_plan_action_ids: insertedRows.map((row) => row.id),
          published_at: publishedAtIso,
        },
      });

      setPublishedAt(publishedAtIso);
      setPublishState('success');
      setConfirmChecked(false);
      clearDraft(draftStorageKey);
      setDraftState('idle');
    } catch (error) {
      console.error('[PlanV2] publish failed:', error);
      setPublishState('error');
      setPublishError('Could not publish tomorrow’s actions. Please try again.');
    }
  };

  if (loading) {
    return (
      <AppShellV2 title="Plan">
        <div className="flex h-full items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin text-red-400" />
            Loading Plan Tomorrow…
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
                  <h2 className="text-base font-semibold text-white">Couldn’t load plan tomorrow</h2>
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
    <AppShellV2 title="Plan">
      <div className="h-full overflow-y-auto px-4 pb-8 pt-5">
        <div className="mx-auto max-w-xl space-y-5">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg shadow-black/20">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Plan Tomorrow</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{formattedDate}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              Finalize direction and measurable actions for {formatSessionDate(tomorrowDate)}.
            </p>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2 text-zinc-200">
              <Target className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">5. Desired Direction</h3>
            </div>
            <label htmlFor="plan-desired-direction" className="mt-4 block text-sm font-medium text-white">
              Ask yourself: Who am I actively becoming?
            </label>
            <textarea
              id="plan-desired-direction"
              value={desiredDirection}
              onChange={(event) => {
                setFormTouched(true);
                setPublishError('');
                setDesiredDirection(event.target.value);
              }}
              rows={3}
              className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            {!desiredDirection.trim() && <p className="mt-2 text-xs text-red-300">Direction is required.</p>}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">6. Highest-ROI Actions</h3>
            <p className="mt-2 text-sm text-zinc-300">
              Ask yourself: What measured task can I commit to tomorrow that will improve me the most?
            </p>

            <div className="mt-4 space-y-4">
              {actions.map((row, index) => {
                const isPrimary = index === 0;
                const showVagueHint = looksVague(row.action_text);
                return (
                  <div key={row.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                        {isPrimary ? 'Primary action' : `Additional action ${index}`}
                      </p>
                      {!isPrimary && (
                        <button
                          type="button"
                          onClick={() => removeAdditionalAction(index)}
                          className="text-xs text-zinc-400 hover:text-white"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <label htmlFor={`plan-action-text-${index}`} className="mt-3 block text-sm font-medium text-white">
                      {isPrimary ? 'Primary measured action' : 'Optional additional action'}
                    </label>
                    <textarea
                      id={`plan-action-text-${index}`}
                      value={row.action_text}
                      onChange={(event) => setActionField(index, 'action_text', event.target.value)}
                      rows={2}
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                    />

                    <label htmlFor={`plan-action-measure-${index}`} className="mt-3 block text-sm font-medium text-white">
                      Completion measure
                    </label>
                    <input
                      id={`plan-action-measure-${index}`}
                      value={row.completion_measure}
                      onChange={(event) => setActionField(index, 'completion_measure', event.target.value)}
                      placeholder="e.g. 3 calls completed with notes"
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                    />

                    <label htmlFor={`plan-action-minimum-${index}`} className="mt-3 block text-sm font-medium text-white">
                      Minimum meaningful version
                    </label>
                    <input
                      id={`plan-action-minimum-${index}`}
                      value={row.minimum_version}
                      onChange={(event) => setActionField(index, 'minimum_version', event.target.value)}
                      placeholder="What still counts as success?"
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                    />

                    <label htmlFor={`plan-action-stretch-${index}`} className="mt-3 block text-sm font-medium text-white">
                      Stretch version (optional)
                    </label>
                    <input
                      id={`plan-action-stretch-${index}`}
                      value={row.stretch_version}
                      onChange={(event) => setActionField(index, 'stretch_version', event.target.value)}
                      placeholder="If energy and time allow"
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                    />

                    {showVagueHint && (
                      <p className="mt-2 text-xs text-amber-300">
                        This looks broad. Add a concrete count, deliverable, or time box.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => applyMeasurableHint(index)}
                      className="mt-2 text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                    >
                      Help me make this measurable
                    </button>

                    {actionErrors[index] && <p className="mt-2 text-xs text-red-300">{actionErrors[index]}</p>}
                  </div>
                );
              })}
            </div>

            {canAddAdditional && (
              <button
                type="button"
                onClick={addAdditionalAction}
                className="mt-3 inline-flex items-center gap-1 rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400"
              >
                <Plus className="h-3.5 w-3.5" /> Add optional action
              </button>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2 text-zinc-200">
              <Moon className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-400">Final confirmation</h3>
            </div>

            <div className="mt-4 rounded-2xl border border-red-500/20 bg-zinc-950/80 p-4">
              <dl className="space-y-3 text-sm text-zinc-300">
                <div>
                  <dt className="text-zinc-500">Who am I actively becoming?</dt>
                  <dd>{desiredDirection.trim() || 'Not filled yet.'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Primary action</dt>
                  <dd>{primaryAction.action_text || 'Not filled yet.'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Completion measure</dt>
                  <dd>{primaryAction.completion_measure || 'Not filled yet.'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Minimum version</dt>
                  <dd>{primaryAction.minimum_version || 'Not filled yet.'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Stretch version</dt>
                  <dd>{primaryAction.stretch_version || 'Not set.'}</dd>
                </div>
                {additionalActions.length > 0 && (
                  <div>
                    <dt className="text-zinc-500">Additional actions</dt>
                    <dd>
                      <ul className="list-disc space-y-1 pl-5">
                        {additionalActions.map((row, index) => (
                          <li key={`${row.id}-${index}`}>{row.action_text} — {row.completion_measure}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
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
                Commit to Tomorrow. Publish these actions so they appear as separate rows on tomorrow’s Today review.
              </span>
            </label>

            <div aria-live="polite" className="mt-3 min-h-6 text-sm">
              {saveDraftState === 'saving' && <span className="text-zinc-400">Saving draft…</span>}
              {saveDraftState === 'success' && <span className="text-emerald-400">Draft saved.</span>}
              {publishState === 'saving' && <span className="text-zinc-400">Publishing tomorrow’s actions…</span>}
              {publishState === 'success' && <span className="text-emerald-400">Tomorrow’s actions are committed.</span>}
              {publishError && <span className="text-red-400">{publishError}</span>}
            </div>

            {publishedAt && (
              <div className="mt-2 text-xs text-zinc-500">Last committed {new Date(publishedAt).toLocaleString()}</div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={saveDraftToSession}
                disabled={!sessionId || saveDraftState === 'saving'}
                className="rounded-full border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={!canPublish}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Commit to Tomorrow
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 text-xs leading-relaxed text-zinc-500">
              {draftState === 'error'
                ? 'Draft could not be stored locally right now.'
                : 'Drafts are stored separately and do not publish actions until you confirm.'}
            </div>
          </section>
        </div>
      </div>
    </AppShellV2>
  );
}
