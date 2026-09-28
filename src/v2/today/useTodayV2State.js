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
} from './model';
import {
  addManualFollowThroughItem,
  archiveHabit,
  buildEmptyHabitDefinition,
  completeTodayV2Review,
  loadTodayReviewState,
  reopenTodayV2Review,
  replaceTomorrowActions,
  setFollowThroughCompletion,
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
  const [tomorrowInput, setTomorrowInputState] = React.useState('');
  const [tomorrowActions, setTomorrowActionsState] = React.useState([]);
  const [desiredDirectionSaveStatus, setDesiredDirectionSaveStatus] = React.useState('idle');
  const [tomorrowPlanSaveStatus, setTomorrowPlanSaveStatus] = React.useState('idle');
  const [tomorrowPlanError, setTomorrowPlanError] = React.useState(null);
  const [completionSaving, setCompletionSaving] = React.useState(false);
  const [customTomorrowActions, setCustomTomorrowActions] = React.useState(false);

  const stateRef = React.useRef(null);
  const desiredDirectionRef = React.useRef('');
  const tomorrowInputRef = React.useRef('');
  const tomorrowActionsRef = React.useRef([]);
  const desiredDirectionSavePromiseRef = React.useRef(Promise.resolve());
  const tomorrowPlanSavePromiseRef = React.useRef(Promise.resolve());
  const desiredDirectionSavingRef = React.useRef(false);
  const tomorrowPlanSavingRef = React.useRef(false);

  stateRef.current = state;
  desiredDirectionRef.current = desiredDirection;
  tomorrowInputRef.current = tomorrowInput;
  tomorrowActionsRef.current = tomorrowActions;

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

  const tomorrowPlanDirty = React.useMemo(() => {
    if (!state) return false;
    return normalizeTodayV2Text(tomorrowInput) !== normalizeTodayV2Text(state.tomorrowPlanInput || '')
      || normalizedTomorrowActions.join('\n') !== loadedTomorrowActions.join('\n');
  }, [loadedTomorrowActions, normalizedTomorrowActions, state, tomorrowInput]);

  const completionGate = React.useMemo(() => getTodayV2CompletionGate({
    followThroughItems: state?.followThroughItems || [],
    habitOccurrences: state?.habitOccurrences || [],
    tomorrowActions,
  }), [state?.followThroughItems, state?.habitOccurrences, tomorrowActions]);

  const setDesiredDirection = React.useCallback((value) => {
    setDesiredDirectionState(value);
  }, []);

  const setTomorrowInput = React.useCallback((value) => {
    setTomorrowInputState(value);
  }, []);

  const setTomorrowActions = React.useCallback((value) => {
    setCustomTomorrowActions(true);
    setTomorrowActionsState((previous) => (typeof value === 'function' ? value(previous) : value));
  }, []);

  const load = React.useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setState(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const next = await loadTodayReviewState(userId);
      const draft = readDraft(userId, next.todayLocalDate);
      const nextDesiredDirection = draft && (draft.desiredDirectionNeedsSync || !normalizeTodayV2Text(next.review?.desired_direction))
        ? String(draft.desiredDirection || '')
        : next.review?.desired_direction || '';
      const nextTomorrowInput = draft && (draft.tomorrowPlanNeedsSync || (!normalizeTodayV2Text(next.tomorrowPlanInput) && normalizeFragmentList(next.tomorrowFragments).length === 0))
        ? String(draft.tomorrowInput || '')
        : next.tomorrowPlanInput || '';
      const nextTomorrowActions = draft && (draft.tomorrowPlanNeedsSync || (!normalizeTodayV2Text(next.tomorrowPlanInput) && normalizeFragmentList(next.tomorrowFragments).length === 0))
        ? coerceTodayV2EditableFragments(String(draft.tomorrowInput || ''), draft.tomorrowActions || [])
        : normalizeFragmentList(next.tomorrowFragments || []);
      const autoSplit = buildTodayV2CommitmentDrafts(nextTomorrowInput).map((draftItem) => draftItem.normalizedFragmentText);

      setState(next);
      setSeedDiagnostic(next.seedDiagnostic || null);
      setDesiredDirectionState(nextDesiredDirection);
      setTomorrowInputState(nextTomorrowInput);
      setTomorrowActionsState(nextTomorrowActions);
      setCustomTomorrowActions(nextTomorrowActions.join('\n') !== autoSplit.join('\n'));
      setDesiredDirectionSaveStatus(draft?.desiredDirectionNeedsSync ? 'offline' : 'saved');
      setTomorrowPlanSaveStatus(draft?.tomorrowPlanNeedsSync ? 'offline' : 'saved');
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
  }, [load]);

  React.useEffect(() => {
    if (customTomorrowActions) return;
    setTomorrowActionsState(buildTodayV2CommitmentDrafts(tomorrowInput).map((draft) => draft.normalizedFragmentText));
  }, [customTomorrowActions, tomorrowInput]);

  React.useEffect(() => {
    if (!userId || !state?.todayLocalDate) return;

    writeDraft(userId, state.todayLocalDate, {
      desiredDirection,
      desiredDirectionNeedsSync: desiredDirectionDirty,
      tomorrowInput,
      tomorrowActions: normalizedTomorrowActions,
      tomorrowPlanNeedsSync: tomorrowPlanDirty,
      updatedAt: new Date().toISOString(),
    });
  }, [desiredDirection, desiredDirectionDirty, normalizedTomorrowActions, state?.todayLocalDate, tomorrowInput, tomorrowPlanDirty, userId]);

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

  const flushTomorrowPlan = React.useCallback(async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    const draft = readDraft(userId, currentState.todayLocalDate);
    if (!tomorrowPlanDirty && !draft?.tomorrowPlanNeedsSync) {
      setTomorrowPlanSaveStatus('saved');
      setTomorrowPlanError(null);
      return;
    }
    if (tomorrowPlanSavingRef.current) return tomorrowPlanSavePromiseRef.current;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setTomorrowPlanSaveStatus('offline');
      return;
    }

    tomorrowPlanSavingRef.current = true;
    setTomorrowPlanSaveStatus('saving');
    setTomorrowPlanError(null);

    const rawPlanText = tomorrowInputRef.current;
    const fragments = coerceTodayV2EditableFragments(rawPlanText, tomorrowActionsRef.current);

    tomorrowPlanSavePromiseRef.current = replaceTomorrowActions({
      targetLocalDate: currentState.tomorrowLocalDate,
      sourceLocalDate: currentState.todayLocalDate,
      timezoneName: currentState.timezoneName,
      rawPlanText,
      actionTexts: fragments,
    })
      .then((savedPlan) => {
        setState((previous) => previous ? {
          ...previous,
          tomorrowPlanInput: savedPlan.rawPlanText,
          tomorrowPlanMeta: {
            ...(previous.tomorrowPlanMeta || {}),
            raw_plan_text: savedPlan.rawPlanText,
            target_local_date: previous.tomorrowLocalDate,
            source_local_date: previous.todayLocalDate,
            timezone_name: previous.timezoneName,
            updated_at: new Date().toISOString(),
          },
          tomorrowFragments: savedPlan.fragments.map((fragmentText, fragmentOrder) => ({
            id: `local-${fragmentOrder}`,
            target_local_date: previous.tomorrowLocalDate,
            source_local_date: previous.todayLocalDate,
            fragment_order: fragmentOrder,
            fragment_text: fragmentText,
            normalized_fragment_text: fragmentText,
            completion_state: TODAY_V2_COMMITMENT_STATES.UNANSWERED,
            answered_at: null,
            parser_version: 'commitment-fragmentation-v2',
          })),
        } : previous);
        setTomorrowActionsState(savedPlan.fragments);
        setTomorrowPlanSaveStatus('saved');
      })
      .catch(async (saveError) => {
        const message = String(saveError?.message || saveError?.details || '');
        const isOverwriteError = /cannot overwrite answered fragments/i.test(message);
        setTomorrowPlanSaveStatus(isOfflineLikeError(saveError) ? 'offline' : 'error');
        setTomorrowPlanError(isOverwriteError ? 'Those follow-through answers are already locked in. Reloaded the current plan instead of overwriting it.' : null);
        if (isOverwriteError) {
          await load();
        }
        throw saveError;
      })
      .finally(() => {
        tomorrowPlanSavingRef.current = false;
      });

    return tomorrowPlanSavePromiseRef.current;
  }, [load, tomorrowPlanDirty, userId]);

  const flushAll = React.useCallback(async () => {
    const results = await Promise.allSettled([flushDesiredDirection(), flushTomorrowPlan()]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw rejected.reason;
    }
    return results;
  }, [flushDesiredDirection, flushTomorrowPlan]);

  const checkForDayRollover = React.useCallback(async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    const nextDateContext = getTodayV2DateContext({ dayBoundaryHour: currentState.dayBoundaryHour });
    if (nextDateContext.todayLocalDate === currentState.todayLocalDate) return;

    setDesiredDirectionState('');
    setTomorrowInputState('');
    setTomorrowActionsState([]);
    setCustomTomorrowActions(false);
    setDesiredDirectionSaveStatus('idle');
    setTomorrowPlanSaveStatus('idle');
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
    if (!state || !tomorrowPlanDirty) return undefined;
    setTomorrowPlanSaveStatus('saving');
    const timeoutId = window.setTimeout(() => {
      void flushTomorrowPlan();
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [flushTomorrowPlan, state, tomorrowPlanDirty]);

  const splitTomorrowActions = React.useCallback(() => {
    setCustomTomorrowActions(false);
    setTomorrowPlanError(null);
    setTomorrowActionsState(
      buildTodayV2CommitmentDrafts(tomorrowInput).map((draft) => draft.normalizedFragmentText)
    );
  }, [tomorrowInput]);

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
    await flushAll();
    try {
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
    tomorrowInput,
    setTomorrowInput,
    tomorrowActions,
    setTomorrowActions,
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
    desiredDirectionSaveStatus,
    desiredDirectionSaveLabel: SAVE_STATUS_LABELS[desiredDirectionSaveStatus] || SAVE_STATUS_LABELS.idle,
    tomorrowPlanSaveStatus,
    tomorrowPlanSaveLabel: SAVE_STATUS_LABELS[tomorrowPlanSaveStatus] || SAVE_STATUS_LABELS.idle,
    tomorrowPlanError,
    isCompleted: Boolean(state?.review?.completed_at),
    createEmptyHabitDefinition: React.useCallback(() => buildEmptyHabitDefinition(state?.habitDefinitions || []), [state?.habitDefinitions]),
  };
}
