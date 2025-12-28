import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { peopleHelpers } from '@/lib/supabase/people';

export function usePeople(userId) {
  return useQuery({
    queryKey: ['people', userId],
    queryFn: () => peopleHelpers.getPeople(userId),
    enabled: !!userId,
  });
}

export function usePerson(personId) {
  return useQuery({
    queryKey: ['people', personId],
    queryFn: () => peopleHelpers.getPerson(personId),
    enabled: !!personId,
  });
}

export function useCreatePerson(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn:  (personData) => peopleHelpers.createPerson(userId, personData),
    onSuccess: () => {
      queryClient. invalidateQueries({ queryKey:  ['people', userId] });
    },
  });
}

export function useUpdatePerson() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ personId, personData }) =>
      peopleHelpers.updatePerson(personId, personData),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['people', variables.personId] });
      queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

export function useDeletePerson() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (personId) => peopleHelpers.deletePerson(personId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

export function useLogInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ personId, date }) =>
      peopleHelpers. logInteraction(personId, date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });
}