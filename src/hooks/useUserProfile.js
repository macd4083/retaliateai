import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userProfileHelpers } from '@/lib/supabase/userProfile';

export function useUserProfile(userId) {
  return useQuery({
    queryKey: ['userProfile', userId],
    queryFn: () => userProfileHelpers.getProfile(userId),
    enabled: !!userId,
  });
}

export function useUpdateUserProfile(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileData) =>
      userProfileHelpers.upsertProfile(userId, profileData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile', userId] });
    },
  });
}

export function useUpdateUserSummary(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ summaryText, summaryFields }) =>
      userProfileHelpers.updateSummary(userId, summaryText, summaryFields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile', userId] });
    },
  });
}