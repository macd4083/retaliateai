import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { goalsHelpers } from '@/lib/supabase/goals';

export function useGoals(userId, status = null) {
  return useQuery({
    queryKey: ['goals', userId, status],
    queryFn: () => goalsHelpers.getGoals(userId, status),
    enabled: !!userId,
  });
}

export function useGoal(goalId) {
  return useQuery({
    queryKey: ['goals', goalId],
    queryFn: () => goalsHelpers.getGoal(goalId),
    enabled: !!goalId,
  });
}

export function useCreateGoal(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalData) => goalsHelpers.createGoal(userId, goalData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals', userId] });
    },
  });
}

export function useUpdateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, goalData }) =>
      goalsHelpers.updateGoal(goalId, goalData),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['goals', variables.goalId] });
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useCompleteGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalId) => goalsHelpers.completeGoal(goalId),
    onSuccess: () => {
      queryClient. invalidateQueries({ queryKey:  ['goals'] });
    },
  });
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalId) => goalsHelpers.deleteGoal(goalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}