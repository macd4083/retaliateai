import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { insightsHelpers as dbInsightsHelpers } from '@/lib/supabase/insights';
import { insightsHelpers as aiInsightsHelpers } from '@/lib/ai';

// Database insights (stored)
export function useInsights(userId, dismissed = false) {
  return useQuery({
    queryKey: ['insights', userId, dismissed],
    queryFn: () => dbInsightsHelpers.getInsights(userId, dismissed),
    enabled: !!userId,
  });
}

export function useCreateInsight(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (insightData) => dbInsightsHelpers.createInsight(userId, insightData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights', userId] });
    },
  });
}

export function useDismissInsight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (insightId) => dbInsightsHelpers.dismissInsight(insightId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights'] });
    },
  });
}

// AI-generated insights (not stored, generated on demand)
export function useGenerateInsights(userId, userSummary) {
  return useMutation({
    mutationFn: ({ question }) =>
      aiInsightsHelpers.generateInsights(userId, userSummary, question),
  });
}

export function useAnswerQuestion(userId, userSummary) {
  return useMutation({
    mutationFn: ({ question }) =>
      aiInsightsHelpers.answerQuestion(userId, userSummary, question),
  });
}