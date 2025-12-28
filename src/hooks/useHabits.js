import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { habitsHelpers } from '@/lib/supabase/habits';

export function useHabits(userId, activeOnly = true) {
  return useQuery({
    queryKey: ['habits', userId, activeOnly],
    queryFn: () => habitsHelpers.getHabits(userId, activeOnly),
    enabled: !!userId,
  });
}

export function useHabit(habitId) {
  return useQuery({
    queryKey: ['habits', habitId],
    queryFn: () => habitsHelpers.getHabit(habitId),
    enabled: !!habitId,
  });
}

export function useCreateHabit(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (habitData) => habitsHelpers.createHabit(userId, habitData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habits', userId] });
    },
  });
}

export function useUpdateHabit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ habitId, habitData }) =>
      habitsHelpers.updateHabit(habitId, habitData),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['habits', variables.habitId] });
      queryClient.invalidateQueries({ queryKey: ['habits'] });
    },
  });
}

export function useDeleteHabit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (habitId) => habitsHelpers.deleteHabit(habitId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
    },
  });
}

export function useLogHabit(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ habitId, notes }) =>
      habitsHelpers.logHabit(userId, habitId, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habitLogs'] });
    },
  });
}

export function useHabitLogs(habitId, startDate = null, endDate = null) {
  return useQuery({
    queryKey:  ['habitLogs', habitId, startDate, endDate],
    queryFn: () => habitsHelpers.getHabitLogs(habitId, startDate, endDate),
    enabled: !!habitId,
  });
}

export function useHabitStats(habitId, days = 30) {
  return useQuery({
    queryKey: ['habitStats', habitId, days],
    queryFn:  () => habitsHelpers.getHabitStats(habitId, days),
    enabled: !!habitId,
  });
}