import React from 'react';
import {
  TODAY_V2_COMMITMENT_STATES,
} from './types';
import {
  buildTodayV2CommitmentDrafts,
  buildTodayV2DraftStorageKey,
  coerceTodayV2EditableFragments,
  getTodayV2CompletionGate,
  getTodayV2DateContext,
  getTodayV2MsUntilNextBoundary,
  normalizeTodayV2Text,
  isTodayV2HabitScheduledForDate,
} from './model';
import { ENABLE_TODAY_V2_SCHEDULER } from '../../lib/featureFlags';
import { createActionIdentity, reconcileActionIdentities, normalizeScheduleBlock } from './scheduling';
import { replaceSchedule, isMissingScheduleSchema } from '../services/scheduling';
import {
  addManualFollowThroughItem,
  archiveHabit,
  buildEmptyHabitDefinition,
  completeTodayV2Review,
  loadTodayReviewState,
  reopenTodayV2Review,
  replaceTomorrowActions,
  removeUnansweredFollowThroughItem,
  setFollowThroughCompletion,
  updateControllableFocus,
  updateDesiredDirection,
  upsertHabitDefinition,
  upsertHabitLog,
} from '../services/todayReview';

const SAVE_STATUS_LABELS = {
  idle: 'Saved ✓',
  saving: 'Saving…',
  saved: 'Saved ✓',
  offline: 'Offline – will retry',
  error: 'Could not save',
};

function readDraft(userId, localDate) {
  if (typeof window === 'undefined' || !userId || !localDate) return null;

  try {
    const raw = window.localStorage.getItem(buildTodayV2DraftStorageKey(userId, localDate));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(userId, localDate, value) {
  if (typeof window === 'undefined' || !userId || !localDate) return;

  try {
    window.localStorage.setItem(buildTodayV2DraftStorageKey(userId, localDate), JSON.stringify(value));
  } catch {
    // Best-effort local fallback only.
  }
}

function isOfflineLikeError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = String(error?.message || error?.details || '');
  return /network|fetch|offline|failed to fetch/i.test(message);
}

function normalizeFragmentList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeTodayV2Text(item?.normalized_fragment_text || item?.fragment_text || item))
    .filter(Boolean);
}

export function useTodayV2State(userId) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [state, setState] = React.useState(null);
  const [seedDiagnostic, setSeedDiagnostic] = React.useState(null);
  const [desiredDirection, setDesiredDirectionState] = React.useState('');
  const [controllableFocus, setControllableFocusState] = React.useState('');
  const [tomorrowInput, setTomorrowInputState] = React.useState('');
  const [tomorrowActions, setTomorrowActionsState] = React.useState([]);
  const [firstFiveMinutes, setFirstFiveMinutesState] = React.useState('');
  const [desiredDirectionSaveStatus, setDesiredDirectionSaveStatus] = React.useState('idle');
  const [controllableFocusSaveStatus, setControllableFocusSaveStatus] = React.useState('idle');
  const [tomorrowPlanSaveStatus, setTomorrowPlanSaveStatus] = React.useState('idle');
  const [firstFiveMinutesSaveStatus, setFirstFiveMinutesSaveStatus] = React.useState('idle');
  const [tomorrowPlanError, setTomorrowPlanError] = React.useState(null);
  const [completionSaving, setCompletionSaving] = React.useState(false);
  const [customTomorrowActions, setCustomTomorrowActions] = React.useState(false);
  const [actionIdentities, setActionIdentities] = React.useState([]);
  const [scheduleBlocks, setScheduleBlocks] = React.useState([]);
  const [scheduleSaveStatus, setScheduleSaveStatus] = React.useState('idle');
  const [scheduleError, setScheduleError] = React.useState(null);
  const identitiesRef = React.useRef([]);
  const scheduleRef = React.useRef([]);
  const scheduleRevisionRef = React.useRef(0);
  const scheduleSavedRevisionRef = React.useRef(0);
  const schedulePromiseRef = React.useRef(null);
  const planRevisionRef = React.useRef(0);
  const loadGenerationRef = React.useRef(0);

  const stateRef = React.useRef(null);
  const desiredDirectionRef = React.useRef('');
  const controllableFocusRef = React.useRef('');
  const tomorrowInputRef = React.useRef('');
  const tomorrowActionsRef = React.useRef([]);
  const firstFiveMinutesRef = React.useRef('');
  const desiredDirectionSavePromiseRef = React.useRef(Promise.resolve());
  const controllableFocusSavePromiseRef = React.useRef(Promise.resolve());
  const tomorrowPlanSavePromiseRef = React.useRef(Promise.resolve());
  const desiredDirectionSavingRef = React.useRef(false);
  const controllableFocusSavingRef = React.useRef(false);
  const tomorrowPlanSavingRef = React.useRef(false);

  stateRef.current = state;
  desiredDirectionRef.current = desiredDirection;
  controllableFocusRef.current = controllableFocus;
  tomorrowInputRef.current = tomorrowInput;
  tomorrowActionsRef.current = tomorrowActions;
  firstFiveMinutesRef.current = firstFiveMinutes;

  const visibleHabits = React.useMemo(
    () => state?.habitOccurrences || [],
    [state?.habitOccurrences]
  );

  const habitDefinitionsById = React.useMemo(() => {
    const entries = (state?.habitDefinitions || []).map((habitDefinition) => [habitDefinition.id, habitDefinition]);
    return new Map(entries);
  }, [state?.habitDefinitions]);

  const loadedTomorrowActions = React.useMemo(
    () => normalizeFragmentList(state?.tomorrowFragments || []),
    [state?.tomorrowFragments]
  );

  const normalizedTomorrowActions = React.useMemo(
    () => coerceTodayV2EditableFragments('', tomorrowActions),
    [tomorrowActions]
  );

  const desiredDirectionDirty = React.useMemo(
    () => normalizeTodayV2Text(desiredDirection) !== normalizeTodayV2Text(state?.review?.desired_direction || ''),
    [desiredDirection, state?.review?.desired_direction]
  );

  const controllableFocusDirty = React.useMemo(
    () => normalizeTodayV2Text(controllableFocus) !== normalizeTodayV2Text(state?.review?.controllable_focus || ''),
    [controllableFocus, state?.review?.controllable_focus]
  );

  const tomorrowPlanDirty = React.useMemo(() => {
    if (!state) return false;
    return normalizeTodayV2Text(tomorrowInput) !== normalizeTodayV2Text(state.tomorrowPlanInput || '')
      || normalizedTomorrowActions.join('\n') !== loadedTomorrowActions.join('\n')
      || normalizeTodayV2Text(firstFiveMinutes) !== normalizeTodayV2Text(state.firstFiveMinutes || '');
  }, [firstFiveMinutes, loadedTomorrowActions, normalizedTomorrowActions, state, tomorrowInput]);

  const completionGate = React.useMemo(() => getTodayV2CompletionGate({
    followThroughItems: state?.followThroughItems || [],
    habitOccurrences: state?.habitOccurrences || [],
    tomorrowActions,
    controllableFocus,
    firstFiveMinutes,
  }), [controllableFocus, firstFiveMinutes, state?.followThroughItems, state?.habitOccurrences, tomorrowActions]);

  const setDesiredDirection = React.useCallback((value) => {
    setDesiredDirectionState(value);
  }, []);

  const setControllableFocus = React.useCallback((value) => {
    setControllableFocusState(value);
  }, []);

  const setTomorrowInput = React.useCallback((value) => {
    tomorrowInputRef.current = value;
    planRevisionRef.current += 1;
    setTomorrowInputState(value);
  }, []);

  const applyActions = React.useCallback((items) => {
    identitiesRef.current = items;
    tomorrowActionsRef.current = items.map((item) => item.text);
    planRevisionRef.current += 1;
    setActionIdentities(items);
    setTomorrowActionsState(tomorrowActionsRef.current);
    const keys = new Set(items.map((item) => item.key));
    const pruned = scheduleRef.current.filter((block) => block.source_type !== 'action' || keys.has(block.source_key));
    if (pruned.length !== scheduleRef.current.length) {
      scheduleRef.current = pruned;
      scheduleRevisionRef.current += 1;
      setScheduleBlocks(pruned);
    }
  }, []);

  const setTomorrowActions = React.useCallback((value) => {
    setCustomTomorrowActions(true);
    const texts = typeof value === 'function' ? value(tomorrowActionsRef.current) : value;
    applyActions(reconcileActionIdentities(identitiesRef.current, texts, { allowSingleEdit: true }));
  }, [applyActions]);

  const editTomorrowAction = React.useCallback((index, text) => {
    setCustomTomorrowActions(true);
    applyActions(identitiesRef.current.map((item, itemIndex) => itemIndex === index ? { ...item, text } : item));
  }, [applyActions]);

  const removeTomorrowAction = React.useCallback((index) => {
    setCustomTomorrowActions(true);
    applyActions(identitiesRef.current.filter((_, itemIndex) => itemIndex !== index));
  }, [applyActions]);

  const setFirstFiveMinutes = React.useCallback((value) => {
    firstFiveMinutesRef.current = value;
    planRevisionRef.current += 1;
    setFirstFiveMinutesState(value);
  }, []);

  const load = React.useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const revision = planRevisionRef.current;
    const scheduleRevision = scheduleRevisionRef.current;
    if (!userId) {
      setLoading(false);
      setState(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const next = await loadTodayReviewState(userId);
      if (generation !== loadGenerationRef.current || revision !== planRevisionRef.current
        || scheduleRevision !== scheduleRevisionRef.current) return;
      const draft = readDraft(userId, next.todayLocalDate);
      const nextDesiredDirection = draft && (draft.desiredDirectionNeedsSync || !normalizeTodayV2Text(next.review?.desired_direction))
        ? String(draft.desiredDirection || '')
        : next.review?.desired_direction || '';
      const nextControllableFocus = draft && (draft.controllableFocusNeedsSync || !normalizeTodayV2Text(next.review?.controllable_focus))
        ? String(draft.controllableFocus || '')
        : next.review?.controllable_focus || '';
      const nextTomorrowInput = draft && (draft.tomorrowPlanNeedsSync || (!normalizeTodayV2Text(next.tomorrowPlanInput) && normalizeFragmentList(next.tomorrowFragments).length === 0))
        ? String(draft.tomorrowInput || '')
        : next.tomorrowPlanInput || '';
      const nextTomorrowActions = draft && (draft.tomorrowPlanNeedsSync || (!normalizeTodayV2Text(next.tomorrowPlanInput) && normalizeFragmentList(next.tomorrowFragments).length === 0))
        ? coerceTodayV2EditableFragments(Array.isArray(draft.tomorrowActions) ? '' : String(draft.tomorrowInput || ''), draft.tomorrowActions || [])
        : normalizeFragmentList(next.tomorrowFragments || []);
      const nextFirstFiveMinutes = draft && draft.tomorrowPlanNeedsSync
        ? String(draft.firstFiveMinutes || '')
        : next.firstFiveMinutes || '';
      const autoSplit = buildTodayV2CommitmentDrafts(nextTomorrowInput).map((draftItem) => draftItem.normalizedFragmentText);
      const savedIdentities = (next.tomorrowFragments || []).map((row) => createActionIdentity(
        normalizeTodayV2Text(row.normalized_fragment_text || row.fragment_text), row.id
      ));
      const draftIdentities = Array.isArray(draft?.actionIdentities) ? draft.actionIdentities : [];
      const recoveringPlan = Boolean(draft?.tomorrowPlanNeedsSync);
      const identityBase = recoveringPlan && draftIdentities.length === nextTomorrowActions.length
        && draftIdentities.every((item, index) => normalizeTodayV2Text(item.text) === nextTomorrowActions[index])
        ? draftIdentities
        : savedIdentities.map((saved) => ({
          ...saved, key: draftIdentities.find((item) => item.persistedId === saved.persistedId)?.key || saved.key,
        }));
      const nextIdentities = (identityBase.length === nextTomorrowActions.length
        && identityBase.every((item, index) => normalizeTodayV2Text(item.text) === nextTomorrowActions[index])
        ? identityBase
        : reconcileActionIdentities(identityBase, nextTomorrowActions)).map((item) => {
        const matches = savedIdentities.filter((saved) => saved.text === item.text);
        const persistedId = savedIdentities.some((saved) => saved.persistedId === item.persistedId) ? item.persistedId : null;
        return { ...item, persistedId: matches.length === 1 ? matches[0].persistedId : persistedId };
      });
      identitiesRef.current = nextIdentities;
      setActionIdentities(nextIdentities);
      const sourceKeys = new Map(nextIdentities.filter((item) => item.persistedId).map((item) => [item.persistedId, item.key]));
      const nextSchedules = draft?.scheduleNeedsSync && Array.isArray(draft.scheduleBlocks)
        ? draft.scheduleBlocks
        : (next.tomorrowSchedules || []).map((row) => ({
          ...row, source_key: row.source_type === 'habit' ? `habit:${row.source_id}` : sourceKeys.get(row.source_id),
        }));
      const validKeys = new Set([...nextIdentities.map((item) => item.key),
        ...(next.habitDefinitions || []).filter((habit) => isTodayV2HabitScheduledForDate(habit, next.tomorrowLocalDate)).map((habit) => `habit:${habit.id}`)]);
      scheduleRef.current = nextSchedules.filter((block) => validKeys.has(block.source_key));
      setScheduleBlocks(scheduleRef.current);
      scheduleRevisionRef.current = draft?.scheduleNeedsSync ? 1 : 0;
      scheduleSavedRevisionRef.current = 0;
      setScheduleSaveStatus(draft?.scheduleNeedsSync ? 'offline' : 'saved');
      setScheduleError(null);

      stateRef.current = next;
      setState(next);
      setSeedDiagnostic(next.seedDiagnostic || null);
      setDesiredDirectionState(nextDesiredDirection);
      setControllableFocusState(nextControllableFocus);
      setTomorrowInputState(nextTomorrowInput);
      setTomorrowActionsState(nextTomorrowActions);
      setFirstFiveMinutesState(nextFirstFiveMinutes);
      setCustomTomorrowActions(nextTomorrowActions.join('\n') !== autoSplit.join('\n'));
      setDesiredDirectionSaveStatus(draft?.desiredDirectionNeedsSync ? 'offline' : 'saved');
      setControllableFocusSaveStatus(draft?.controllableFocusNeedsSync ? 'offline' : 'saved');
      setTomorrowPlanSaveStatus(draft?.tomorrowPlanNeedsSync ? 'offline' : 'saved');
      setFirstFiveMinutesSaveStatus(draft?.tomorrowPlanNeedsSync ? 'offline' : 'saved');
      setTomorrowPlanError(null);
    } catch (loadError) {
      console.error('[TodayV2] load failed:', loadError);
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    load();
    return () => { loadGenerationRef.current += 1; };
  }, [load]);

  React.useEffect(() => {
    if (customTomorrowActions) return;
    const texts = buildTodayV2CommitmentDrafts(tomorrowInput).map((draft) => draft.normalizedFragmentText);
    if (texts.join('\n') !== tomorrowActionsRef.current.join('\n')) {
      applyActions(reconcileActionIdentities(identitiesRef.current, texts));
    }
  }, [applyActions, customTomorrowActions, tomorrowInput]);

  React.useEffect(() => {
    if (!userId || !state?.todayLocalDate) return;

    writeDraft(userId, state.todayLocalDate, {
      desiredDirection,
      desiredDirectionNeedsSync: desiredDirectionDirty,
      controllableFocus,
      controllableFocusNeedsSync: controllableFocusDirty,
      tomorrowInput,
      tomorrowActions: normalizedTomorrowActions,
      customTomorrowActions,
      actionIdentities,
      scheduleBlocks,
      scheduleNeedsSync: scheduleRevisionRef.current !== scheduleSavedRevisionRef.current,
      firstFiveMinutes,
      tomorrowPlanNeedsSync: tomorrowPlanDirty,
      updatedAt: new Date().toISOString(),
    });
  }, [customTomorrowActions, actionIdentities, scheduleBlocks, scheduleSaveStatus, controllableFocus, controllableFocusDirty, desiredDirection, desiredDirectionDirty, firstFiveMinutes, normalizedTomorrowActions, state?.todayLocalDate, tomorrowInput, tomorrowPlanDirty, userId]);

  const flushDesiredDirection = React.useCallback(async () => {
    const reviewId = stateRef.current?.review?.id;
    if (!reviewId) return;
    if (!normalizeTodayV2Text(desiredDirectionRef.current) && !normalizeTodayV2Text(stateRef.current?.review?.desired_direction || '')) {
      setDesiredDirectionSaveStatus('saved');
      return;
    }
    if (!desiredDirectionDirty && !readDraft(userId, stateRef.current?.todayLocalDate)?.desiredDirectionNeedsSync) {
      setDesiredDirectionSaveStatus('saved');
      return;
    }
    if (desiredDirectionSavingRef.current) return desiredDirectionSavePromiseRef.current;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setDesiredDirectionSaveStatus('offline');
      return;
    }

    desiredDirectionSavingRef.current = true;
    setDesiredDirectionSaveStatus('saving');
    const nextDirection = desiredDirectionRef.current;

    desiredDirectionSavePromiseRef.current = updateDesiredDirection(reviewId, nextDirection)
      .then(() => {
        setState((previous) => previous ? {
          ...previous,
          review: {
            ...previous.review,
            desired_direction: normalizeTodayV2Text(nextDirection),
          },
        } : previous);
        setDesiredDirectionSaveStatus('saved');
      })
      .catch((saveError) => {
        setDesiredDirectionSaveStatus(isOfflineLikeError(saveError) ? 'offline' : 'error');
        throw saveError;
      })
      .finally(() => {
        desiredDirectionSavingRef.current = false;
      });

    return desiredDirectionSavePromiseRef.current;
  }, [desiredDirectionDirty, userId]);

  const flushControllableFocus = React.useCallback(async () => {
    const reviewId = stateRef.current?.review?.id;
    if (!reviewId) return;
    if (!controllableFocusDirty && !readDraft(userId, stateRef.current?.todayLocalDate)?.controllableFocusNeedsSync) {
      setControllableFocusSaveStatus('saved');
      return;
    }
    if (controllableFocusSavingRef.current) return controllableFocusSavePromiseRef.current;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setControllableFocusSaveStatus('offline');
      return;
    }

    controllableFocusSavingRef.current = true;
    setControllableFocusSaveStatus('saving');
    const nextFocus = controllableFocusRef.current;

    controllableFocusSavePromiseRef.current = updateControllableFocus(reviewId, nextFocus)
      .then(() => {
        setState((previous) => previous ? {
          ...previous,
          review: {
            ...previous.review,
            controllable_focus: normalizeTodayV2Text(nextFocus) || null,
          },
        } : previous);
        setControllableFocusSaveStatus('saved');
      })
      .catch((saveError) => {
        setControllableFocusSaveStatus(isOfflineLikeError(saveError) ? 'offline' : 'error');
        throw saveError;
      })
      .finally(() => {
        controllableFocusSavingRef.current = false;
      });

    return controllableFocusSavePromiseRef.current;
  }, [controllableFocusDirty, userId]);

  const flushTomorrowPlan = React.useCallback(async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    const currentDirty = normalizeTodayV2Text(tomorrowInputRef.current) !== normalizeTodayV2Text(currentState.tomorrowPlanInput)
      || coerceTodayV2EditableFragments('', tomorrowActionsRef.current).join('\n') !== normalizeFragmentList(currentState.tomorrowFragments).join('\n')
      || normalizeTodayV2Text(firstFiveMinutesRef.current) !== normalizeTodayV2Text(currentState.firstFiveMinutes);
    if (!currentDirty) {
      setTomorrowPlanSaveStatus('saved');
      setFirstFiveMinutesSaveStatus('saved');
      setTomorrowPlanError(null);
      return;
    }
    if (tomorrowPlanSavingRef.current) {
      await tomorrowPlanSavePromiseRef.current;
      return flushTomorrowPlan();
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setTomorrowPlanSaveStatus('offline');
      setFirstFiveMinutesSaveStatus('offline');
      throw new Error('Offline – will retry');
    }

    tomorrowPlanSavingRef.current = true;
    setTomorrowPlanSaveStatus('saving');
    setFirstFiveMinutesSaveStatus('saving');
    setTomorrowPlanError(null);

    const rawPlanText = tomorrowInputRef.current;
    const fragments = coerceTodayV2EditableFragments('', tomorrowActionsRef.current);
    const firstFiveMinutesValue = firstFiveMinutesRef.current;
    const snapshot = identitiesRef.current.filter((item) => normalizeTodayV2Text(item.text));
    const revision = planRevisionRef.current;
    const generation = loadGenerationRef.current;

    tomorrowPlanSavePromiseRef.current = replaceTomorrowActions({
      targetLocalDate: currentState.tomorrowLocalDate,
      sourceLocalDate: currentState.todayLocalDate,
      timezoneName: currentState.timezoneName,
      rawPlanText,
      actionTexts: fragments,
      firstFiveMinutes: firstFiveMinutesValue,
      fragmentIds: snapshot.map((item) => item.persistedId),
      scheduleAvailable: currentState.scheduleAvailable,
      userId,
      explicitActions: true,
    })
      .then((savedPlan) => {
        if (generation !== loadGenerationRef.current) return;
        const savedRows = savedPlan.savedFragments || [];
        const savedIds = new Map(snapshot.map((item, index) => [item.key, savedRows[index]?.id || null]));
        identitiesRef.current = identitiesRef.current.map((item) => savedIds.has(item.key)
          ? { ...item, persistedId: savedIds.get(item.key) } : item);
        setActionIdentities(identitiesRef.current);
        const nextState = {
          ...stateRef.current,
          tomorrowPlanInput: savedPlan.rawPlanText,
          firstFiveMinutes: normalizeTodayV2Text(firstFiveMinutesValue),
          tomorrowFragments: savedRows,
          ...(savedPlan.scheduleAvailable === false ? {
            scheduleAvailable: false, scheduleDiagnostic: savedPlan.scheduleDiagnostic,
          } : {}),
        };
        stateRef.current = nextState;
        setState((previous) => previous ? {
          ...previous,
          tomorrowPlanInput: savedPlan.rawPlanText,
          firstFiveMinutes: normalizeTodayV2Text(firstFiveMinutesValue),
          tomorrowPlanMeta: {
            ...(previous.tomorrowPlanMeta || {}),
            raw_plan_text: savedPlan.rawPlanText,
            first_five_minutes: normalizeTodayV2Text(firstFiveMinutesValue) || null,
            target_local_date: previous.tomorrowLocalDate,
            source_local_date: previous.todayLocalDate,
            timezone_name: previous.timezoneName,
            updated_at: new Date().toISOString(),
          },
          tomorrowFragments: savedRows,
          ...(savedPlan.scheduleAvailable === false ? {
            scheduleAvailable: false, scheduleDiagnostic: savedPlan.scheduleDiagnostic,
          } : {}),
        } : previous);
        if (revision === planRevisionRef.current) {
          setTomorrowPlanSaveStatus('saved');
          setFirstFiveMinutesSaveStatus('saved');
        }
      })
      .catch(async (saveError) => {
        const message = String(saveError?.message || saveError?.details || '');
        const isOverwriteError = /cannot overwrite answered fragments/i.test(message);
        setTomorrowPlanSaveStatus(isOfflineLikeError(saveError) ? 'offline' : 'error');
        setFirstFiveMinutesSaveStatus(isOfflineLikeError(saveError) ? 'offline' : 'error');
        setTomorrowPlanError(isOverwriteError ? 'Those follow-through answers are already locked in. Reloaded the current plan instead of overwriting it.' : null);
        if (isOverwriteError) {
          await load();
        }
        throw saveError;
      })
      .finally(() => {
        tomorrowPlanSavingRef.current = false;
      });

    await tomorrowPlanSavePromiseRef.current;
    if (generation === loadGenerationRef.current && revision !== planRevisionRef.current) {
      return flushTomorrowPlan();
    }
  }, [load, userId]);

  const scheduleAvailable = ENABLE_TODAY_V2_SCHEDULER && Boolean(state?.scheduleAvailable);
  const schedulerItems = React.useMemo(() => [
    ...actionIdentities.filter((item) => normalizeTodayV2Text(item.text)).map((item) => ({
      id: item.key, key: item.key, type: 'action', label: item.text, source_id: item.persistedId,
    })),
    ...(state?.habitDefinitions || [])
      .filter((habit) => isTodayV2HabitScheduledForDate(habit, state.tomorrowLocalDate))
      .map((habit) => ({ id: `habit:${habit.id}`, key: `habit:${habit.id}`, type: 'habit', label: habit.name, source_id: habit.id })),
  ], [actionIdentities, state?.habitDefinitions, state?.tomorrowLocalDate]);

  const updateSchedule = React.useCallback((itemKey, times) => {
    const item = schedulerItems.find((candidate) => candidate.id === itemKey);
    if (!item) throw new Error('Unknown schedule item');
    const block = normalizeScheduleBlock({
      source_key: itemKey, source_type: item.type, source_id: item.source_id, ...times,
    });
    const next = [...scheduleRef.current.filter((row) => row.source_key !== itemKey), block];
    scheduleRef.current = next;
    scheduleRevisionRef.current += 1;
    setScheduleBlocks(next);
    setScheduleSaveStatus('idle');
    setScheduleError(null);
  }, [schedulerItems]);

  const unschedule = React.useCallback((itemKey) => {
    scheduleRef.current = scheduleRef.current.filter((row) => row.source_key !== itemKey);
    scheduleRevisionRef.current += 1;
    setScheduleBlocks(scheduleRef.current);
    setScheduleSaveStatus('idle');
    setScheduleError(null);
  }, []);

  const flushSchedule = React.useCallback(async () => {
    const requireAvailability = () => {
      if (ENABLE_TODAY_V2_SCHEDULER && stateRef.current?.scheduleAvailable) return true;
      if (scheduleSavedRevisionRef.current !== scheduleRevisionRef.current) {
        const pendingError = new Error('Scheduling is unavailable. Pending schedule changes are saved locally; retry before completing.');
        setScheduleSaveStatus('error');
        setScheduleError(pendingError);
        throw pendingError;
      }
      return false;
    };
    if (!requireAvailability()) return;
    if (schedulePromiseRef.current) return schedulePromiseRef.current;
    const generation = loadGenerationRef.current;
    schedulePromiseRef.current = (async () => {
      // Drain in-flight edits before mapping client keys to real persisted sources.
      let planRevision;
      do {
        planRevision = planRevisionRef.current;
        await flushTomorrowPlan();
      } while (planRevision !== planRevisionRef.current);
      if (!requireAvailability()) return;
      while (scheduleSavedRevisionRef.current !== scheduleRevisionRef.current) {
        if (generation !== loadGenerationRef.current) return;
        const currentState = stateRef.current;
        const revision = scheduleRevisionRef.current;
        const snapshot = scheduleRef.current;
        const identities = new Map(identitiesRef.current.map((item) => [item.key, item.persistedId]));
        const blocks = snapshot.map((block) => {
          const sourceId = block.source_type === 'habit' ? block.source_id : identities.get(block.source_key);
          if (!sourceId) throw new Error('Save the action before scheduling it');
          return { source_type: block.source_type, source_id: sourceId, starts_at: block.starts_at, ends_at: block.ends_at };
        });
        setScheduleSaveStatus('saving');
        const rows = await replaceSchedule({
          targetLocalDate: currentState.tomorrowLocalDate, timezoneName: currentState.timezoneName, blocks,
        });
        if (generation !== loadGenerationRef.current) return;
        scheduleSavedRevisionRef.current = revision;
        if (revision === scheduleRevisionRef.current) {
          scheduleRef.current = snapshot.map((block) => ({
            ...block, ...rows.find((row) => row.source_type === block.source_type
              && row.source_id === (block.source_type === 'habit' ? block.source_id : identities.get(block.source_key))),
          }));
          setScheduleBlocks(scheduleRef.current);
        }
        setState((previous) => previous ? { ...previous, tomorrowSchedules: rows } : previous);
        if (planRevision !== planRevisionRef.current) {
          planRevision = planRevisionRef.current;
          await flushTomorrowPlan();
        }
      }
      setScheduleSaveStatus('saved');
      setScheduleError(null);
    })().catch((saveError) => {
      setScheduleSaveStatus(isOfflineLikeError(saveError) ? 'offline' : 'error');
      setScheduleError(saveError);
      if (isMissingScheduleSchema(saveError)) {
        setState((previous) => previous ? { ...previous, scheduleAvailable: false,
          scheduleDiagnostic: { code: saveError.code, message: saveError.message } } : previous);
      }
      throw saveError;
    }).finally(() => { schedulePromiseRef.current = null; });
    return schedulePromiseRef.current;
  }, [flushTomorrowPlan]);

  const flushAll = React.useCallback(async () => {
    const results = await Promise.allSettled([flushDesiredDirection(), flushControllableFocus(), flushTomorrowPlan()]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw rejected.reason;
    }
    await flushSchedule();
    return results;
  }, [flushControllableFocus, flushDesiredDirection, flushTomorrowPlan, flushSchedule]);

  React.useEffect(() => {
    if (!scheduleAvailable || scheduleRevisionRef.current === scheduleSavedRevisionRef.current) return undefined;
    const timeoutId = window.setTimeout(() => {
      void flushSchedule().catch(() => {});
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [flushSchedule, scheduleAvailable, scheduleBlocks]);

  const checkForDayRollover = React.useCallback(async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    const nextDateContext = getTodayV2DateContext({ dayBoundaryHour: currentState.dayBoundaryHour });
    if (nextDateContext.todayLocalDate === currentState.todayLocalDate) return;

    setDesiredDirectionState('');
    setControllableFocusState('');
    setTomorrowInputState('');
    setTomorrowActionsState([]);
    setFirstFiveMinutesState('');
    setCustomTomorrowActions(false);
    setDesiredDirectionSaveStatus('idle');
    setControllableFocusSaveStatus('idle');
    setTomorrowPlanSaveStatus('idle');
    setFirstFiveMinutesSaveStatus('idle');
    setTomorrowPlanError(null);
    await load();
  }, [load]);

  React.useEffect(() => {
    if (!userId || typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushAll();
        return;
      }
      void checkForDayRollover();
    };

    const handleFocus = () => {
      void checkForDayRollover();
    };

    const handlePageShow = () => {
      void checkForDayRollover();
    };

    const handlePageHide = () => {
      void flushAll();
    };

    const handleOnline = () => {
      void flushAll();
      void checkForDayRollover();
    };

    const intervalId = window.setInterval(() => {
      void checkForDayRollover();
    }, 60_000);

    const timeoutId = window.setTimeout(() => {
      void checkForDayRollover();
    }, getTodayV2MsUntilNextBoundary({ dayBoundaryHour: state?.dayBoundaryHour }) + 1_000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('online', handleOnline);
    };
  }, [checkForDayRollover, flushAll, state?.dayBoundaryHour, userId]);

  React.useEffect(() => {
    if (!state || !desiredDirectionDirty) return undefined;
    setDesiredDirectionSaveStatus('saving');
    const timeoutId = window.setTimeout(() => {
      void flushDesiredDirection();
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [desiredDirectionDirty, flushDesiredDirection, state]);

  React.useEffect(() => {
    if (!state || !controllableFocusDirty) return undefined;
    setControllableFocusSaveStatus('saving');
    const timeoutId = window.setTimeout(() => {
      void flushControllableFocus();
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [controllableFocusDirty, flushControllableFocus, state]);

  React.useEffect(() => {
    if (!state || !tomorrowPlanDirty) return undefined;
    setTomorrowPlanSaveStatus('saving');
    setFirstFiveMinutesSaveStatus('saving');
    const timeoutId = window.setTimeout(() => {
      void flushTomorrowPlan();
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [flushTomorrowPlan, state, tomorrowPlanDirty]);

  const splitTomorrowActions = React.useCallback(() => {
    setCustomTomorrowActions(false);
    setTomorrowPlanError(null);
    applyActions(reconcileActionIdentities(identitiesRef.current,
      buildTodayV2CommitmentDrafts(tomorrowInput).map((draft) => draft.normalizedFragmentText)));
  }, [applyActions, tomorrowInput]);

  const saveTomorrowPlan = React.useCallback(async () => flushTomorrowPlan(), [flushTomorrowPlan]);

  const saveCommitmentCompletion = React.useCallback(async (fragmentId, completionState) => {
    const nextState = completionState || TODAY_V2_COMMITMENT_STATES.UNANSWERED;
    const savedRow = await setFollowThroughCompletion(fragmentId, nextState);
    setState((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        followThroughItems: previous.followThroughItems.map((item) => (
          item.id === fragmentId
            ? { ...item, ...savedRow }
            : item
        )),
      };
    });
  }, []);

  const removeFollowThrough = React.useCallback(async (fragmentId) => {
    const item = stateRef.current?.followThroughItems?.find((row) => row.id === fragmentId);
    if (!userId || !item || item.answered_at || item.completion_state !== TODAY_V2_COMMITMENT_STATES.UNANSWERED) {
      throw new Error('Only unanswered follow-through items can be removed');
    }
    const removedId = await removeUnansweredFollowThroughItem(userId, fragmentId);
    setState((previous) => previous ? {
      ...previous, followThroughItems: previous.followThroughItems.filter((row) => row.id !== removedId),
      todaySchedules: (previous.todaySchedules || []).filter((row) => row.source_type !== 'action' || row.source_id !== removedId),
    } : previous);
    return removedId;
  }, [userId]);
 
  const saveDesiredDirection = React.useCallback(async () => flushDesiredDirection(), [flushDesiredDirection]);

  const saveHabitDefinition = React.useCallback(async (habitDraft) => {
    if (!userId) return null;
    const id = await upsertHabitDefinition(userId, habitDraft);
    await load();
    return id;
  }, [load, userId]);

  const archiveHabitDefinition = React.useCallback(async (habitId) => {
    await archiveHabit(userId, habitId);
    await load();
  }, [load, userId]);

  const saveHabitResponse = React.useCallback(async (occurrence, value) => {
    const savedOccurrence = await upsertHabitLog(occurrence.id, occurrence.snapshot_response_type, value);
    setState((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        habitOccurrences: previous.habitOccurrences.map((item) => (
          item.id === occurrence.id
            ? { ...item, ...savedOccurrence }
            : item
        )),
      };
    });
  }, []);

  const addManualFollowThrough = React.useCallback(async (actionText) => {
    if (!state || !userId) return null;
    const nextFragmentOrder = state.followThroughItems.reduce(
      (maxOrder, item) => Math.max(maxOrder, Number(item.fragment_order ?? -1)),
      -1
    ) + 1;

    const created = await addManualFollowThroughItem(
      userId,
      state.todayLocalDate,
      actionText,
      nextFragmentOrder,
      state.timezoneName
    );

    setState((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        followThroughItems: [...previous.followThroughItems, created],
      };
    });

    return created;
  }, [state, userId]);

  const completeReview = React.useCallback(async () => {
    if (!state?.review?.id) return null;
    setCompletionSaving(true);
    try {
      await flushAll();
      const savedReview = await completeTodayV2Review(state.review.id);
      setState((previous) => previous ? {
        ...previous,
        review: {
          ...previous.review,
          ...savedReview,
        },
        routeTarget: '/home',
      } : previous);
      return savedReview;
    } finally {
      setCompletionSaving(false);
    }
  }, [flushAll, state?.review?.id]);

  const reopenReview = React.useCallback(async () => {
    if (!state?.review?.id) return null;
    const savedReview = await reopenTodayV2Review(state.review.id);
    setState((previous) => previous ? {
      ...previous,
      review: {
        ...previous.review,
        ...savedReview,
      },
      routeTarget: '/today',
    } : previous);
    return savedReview;
  }, [state?.review?.id]);

  return {
    loading,
    error,
    state,
    seedDiagnostic,
    desiredDirection,
    setDesiredDirection,
    controllableFocus,
    setControllableFocus,
    tomorrowInput,
    setTomorrowInput,
    tomorrowActions,
    tomorrowActionKeys: actionIdentities.map((item) => item.key),
    tomorrowActionItems: actionIdentities.map((item) => ({
      id: item.key, key: item.key, text: item.text, label: item.text, type: 'action',
      persistedId: item.persistedId, source_id: item.persistedId,
    })),
    setTomorrowActions,
    editTomorrowAction,
    removeTomorrowAction,
    schedulerItems,
    scheduleBlocks,
    scheduleSaveStatus,
    scheduleSaveLabel: SAVE_STATUS_LABELS[scheduleSaveStatus] || SAVE_STATUS_LABELS.idle,
    scheduleError,
    scheduleAvailable,
    scheduleDiagnostic: state?.scheduleDiagnostic || null,
    updateSchedule,
    unschedule,
    flushSchedule,
    flushAll,
    firstFiveMinutes,
    setFirstFiveMinutes,
    visibleHabits,
    habitDefinitionsById,
    load,
    splitTomorrowActions,
    saveTomorrowPlan,
    saveCommitmentCompletion,
    removeFollowThrough,
    saveDesiredDirection,
    saveHabitDefinition,
    archiveHabitDefinition,
    saveHabitResponse,
    addManualFollowThrough,
    completeReview,
    reopenReview,
    completionGate,
    completionSaving,
    desiredDirectionSaveStatus,
    desiredDirectionSaveLabel: SAVE_STATUS_LABELS[desiredDirectionSaveStatus] || SAVE_STATUS_LABELS.idle,
    controllableFocusSaveStatus,
    controllableFocusSaveLabel: SAVE_STATUS_LABELS[controllableFocusSaveStatus] || SAVE_STATUS_LABELS.idle,
    tomorrowPlanSaveStatus,
    tomorrowPlanSaveLabel: SAVE_STATUS_LABELS[tomorrowPlanSaveStatus] || SAVE_STATUS_LABELS.idle,
    firstFiveMinutesSaveStatus,
    firstFiveMinutesSaveLabel: SAVE_STATUS_LABELS[firstFiveMinutesSaveStatus] || SAVE_STATUS_LABELS.idle,
    tomorrowPlanError,
    isCompleted: Boolean(state?.review?.completed_at),
    createEmptyHabitDefinition: React.useCallback(() => buildEmptyHabitDefinition(state?.habitDefinitions || []), [state?.habitDefinitions]),
  };
}
