import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { goalActionsHelpers } from '@/lib/supabase/goalActions';

export function useGoalActions(goalId, status = null) {
  return useQuery({
    queryKey: ['goalActions', goalId, status],
    queryFn: () => goalActionsHelpers.getGoalActions(goalId, status),
    enabled: !!goalId,
  });
}

export function useGoalAction(actionId) {
  return useQuery({
    queryKey: ['goalActions', actionId],
    queryFn: () => goalActionsHelpers.getGoalAction(actionId),
    enabled: !!actionId,
  });
}

export function useCreateGoalAction(goalId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actionData) => goalActionsHelpers.createGoalAction(goalId, actionData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goalActions', goalId] });
    },
  });
}

export function useUpdateGoalAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ actionId, actionData }) =>
      goalActionsHelpers.updateGoalAction(actionId, actionData),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['goalActions'] });
    },
  });
}

export function useCompleteGoalAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actionId) => goalActionsHelpers.completeGoalAction(actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goalActions'] });
    },
  });
}

export function useArchiveGoalAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actionId) => goalActionsHelpers.archiveGoalAction(actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goalActions'] });
    },
  });
}

export function useDeleteGoalAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actionId) => goalActionsHelpers.deleteGoalAction(actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goalActions'] });
    },
  });
}