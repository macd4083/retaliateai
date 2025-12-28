import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { journalHelpers } from '@/lib/supabase/journal';
import { aiWorkflows } from '@/lib/ai';

export function useJournalEntries(userId, options = {}) {
  return useQuery({
    queryKey: ['journal', userId],
    queryFn: () => journalHelpers.getEntries(userId, options),
    enabled: !!userId,
  });
}

export function useJournalEntry(entryId) {
  return useQuery({
    queryKey: ['journal', entryId],
    queryFn: () => journalHelpers.getEntry(entryId),
    enabled: !!entryId,
  });
}

export function useCreateJournalEntry(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryData) => aiWorkflows.processNewEntry(userId, entryData),
    onSuccess: () => {
      // Invalidate and refetch journal entries
      queryClient.invalidateQueries({ queryKey: ['journal', userId] });
    },
  });
}

export function useUpdateJournalEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, entryData }) =>
      journalHelpers.updateEntry(entryId, entryData),
    onSuccess: (data, variables) => {
      // Invalidate the specific entry and the list
      queryClient.invalidateQueries({ queryKey: ['journal', variables.entryId] });
      queryClient.invalidateQueries({ queryKey: ['journal'] });
    },
  });
}

export function useDeleteJournalEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId) => journalHelpers.deleteEntry(entryId),
    onSuccess: () => {
      // Invalidate all journal queries
      queryClient.invalidateQueries({ queryKey: ['journal'] });
    },
  });
}

export function useSearchJournalEntries(userId) {
  return useMutation({
    mutationFn: (searchQuery) => journalHelpers.searchEntries(userId, searchQuery),
  });
}