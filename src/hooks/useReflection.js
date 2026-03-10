import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reflectionHelpers } from '@/lib/supabase/reflection';

export function useReflectionSession(userId) {
  return useQuery({
    queryKey: ['reflectionSession', userId],
    queryFn: () => reflectionHelpers.getTodaySession(userId),
    enabled: !!userId,
  });
}

export function useYesterdayCommitment(userId) {
  return useQuery({
    queryKey: ['yesterdayCommitment', userId],
    queryFn: () => reflectionHelpers.getYesterdayCommitment(userId),
    enabled: !!userId,
  });
}

export function useSaveMessage() {
  return useMutation({
    mutationFn: ({ sessionId, userId, messageData }) =>
      reflectionHelpers.saveMessage(sessionId, userId, messageData),
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, updates }) =>
      reflectionHelpers.updateSession(sessionId, updates),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reflectionSession'] });
    },
  });
}

export function useReflectionStreak(userId) {
  return useQuery({
    queryKey: ['reflectionStreak', userId],
    queryFn: () => reflectionHelpers.getReflectionStreak(userId),
    enabled: !!userId,
  });
}

export function useSessionMessages(sessionId) {
  return useQuery({
    queryKey: ['reflectionMessages', sessionId],
    queryFn: () => reflectionHelpers.getSessionMessages(sessionId),
    enabled: !!sessionId,
  });
}
