import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { todosHelpers } from '@/lib/supabase/todos';

export function useTodos(userId, completed = null) {
  return useQuery({
    queryKey: ['todos', userId, completed],
    queryFn: () => todosHelpers.getTodos(userId, completed),
    enabled: !!userId,
  });
}

export function useTodo(todoId) {
  return useQuery({
    queryKey:  ['todos', todoId],
    queryFn: () => todosHelpers.getTodo(todoId),
    enabled: !!todoId,
  });
}

export function useCreateTodo(userId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (todoData) => todosHelpers.createTodo(userId, todoData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos', userId] });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ todoId, todoData }) =>
      todosHelpers. updateTodo(todoId, todoData),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['todos', variables. todoId] });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

export function useToggleTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ todoId, completed }) =>
      todosHelpers.toggleTodo(todoId, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (todoId) => todosHelpers.deleteTodo(todoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}