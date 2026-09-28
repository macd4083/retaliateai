import React from 'react';
import {
  TODAY_V2_COMMITMENT_STATES,
  TODAY_V2_RESPONSE_TYPES,
} from './types';
import { buildTodayV2CommitmentDrafts } from './model';
import {
  addManualFollowThroughItem,
  archiveHabit,
  buildEmptyHabitDefinition,
  loadTodayReviewState,
  replaceTomorrowActions,
  setFollowThroughCompletion,
  updateDesiredDirection,
  upsertHabitDefinition,
  upsertHabitLog,
} from '../services/todayReview';

export function useTodayV2State(userId) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [state, setState] = React.useState(null);
  const [seedDiagnostic, setSeedDiagnostic] = React.useState(null);
  const [desiredDirection, setDesiredDirection] = React.useState('');
  const [tomorrowInput, setTomorrowInput] = React.useState('');
  const [tomorrowActions, setTomorrowActions] = React.useState([]);

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
      setState(next);
      setSeedDiagnostic(next.seedDiagnostic || null);
      setDesiredDirection(next.review?.desired_direction || '');
      setTomorrowInput(next.tomorrowPlanInput || '');
      setTomorrowActions(
        (next.tomorrowFragments || []).map((fragment) => fragment.normalized_fragment_text || fragment.fragment_text)
      );
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

  const habitDefinitionsById = React.useMemo(() => {
    const entries = (state?.habitDefinitions || []).map((habitDefinition) => [habitDefinition.id, habitDefinition]);
    return new Map(entries);
  }, [state?.habitDefinitions]);

  const visibleHabits = React.useMemo(
    () => state?.habitOccurrences || [],
    [state?.habitOccurrences]
  );

  const splitTomorrowActions = React.useCallback(() => {
    setTomorrowActions(
      buildTodayV2CommitmentDrafts(tomorrowInput).map((draft) => draft.normalizedFragmentText)
    );
  }, [tomorrowInput]);

  const saveTomorrowPlan = React.useCallback(async () => {
    if (!state) return;

    await replaceTomorrowActions({
      targetLocalDate: state.tomorrowLocalDate,
      sourceLocalDate: state.todayLocalDate,
      timezoneName: state.timezoneName,
      rawPlanText: tomorrowInput,
      actionTexts: tomorrowActions,
    });

    await load();
  }, [load, state, tomorrowActions, tomorrowInput]);

  const saveCommitmentCompletion = React.useCallback(async (fragmentId, completionState) => {
    const nextState = completionState || TODAY_V2_COMMITMENT_STATES.UNANSWERED;
    await setFollowThroughCompletion(fragmentId, nextState);
    setState((previous) => ({
      ...previous,
      followThroughItems: previous.followThroughItems.map((item) => (
        item.id === fragmentId
          ? {
            ...item,
            completion_state: nextState,
            answered_at: nextState === TODAY_V2_COMMITMENT_STATES.UNANSWERED ? null : new Date().toISOString(),
          }
          : item
      )),
    }));
  }, []);

  const saveDesiredDirection = React.useCallback(async () => {
    if (!state?.review?.id) return;
    await updateDesiredDirection(state.review.id, desiredDirection.trim());
  }, [desiredDirection, state?.review?.id]);

  const saveHabitDefinition = React.useCallback(async (habitDraft) => {
    if (!userId) return null;
    const id = await upsertHabitDefinition(userId, habitDraft);
    await load();
    return id;
  }, [load, userId]);

  const archiveHabitDefinition = React.useCallback(async (habitId) => {
    await archiveHabit(habitId);
    await load();
  }, [load]);

  const saveHabitResponse = React.useCallback(async (occurrence, value) => {
    await upsertHabitLog(occurrence.id, occurrence.snapshot_response_type, value);
    setState((previous) => ({
      ...previous,
      habitOccurrences: previous.habitOccurrences.map((item) => (
        item.id === occurrence.id
          ? {
            ...item,
            boolean_response: occurrence.snapshot_response_type === TODAY_V2_RESPONSE_TYPES.BOOLEAN
              ? (value == null ? null : Boolean(value))
              : null,
            numeric_response: occurrence.snapshot_response_type === TODAY_V2_RESPONSE_TYPES.NUMBER && Number.isFinite(value)
              ? value
              : null,
            answered_at: value == null || value === '' ? null : new Date().toISOString(),
          }
          : item
      )),
    }));
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

    setState((previous) => ({
      ...previous,
      followThroughItems: [...previous.followThroughItems, created],
    }));

    return created;
  }, [state, userId]);

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
    createEmptyHabitDefinition: React.useCallback(() => buildEmptyHabitDefinition(state?.habitDefinitions || []), [state?.habitDefinitions]),
  };
}
