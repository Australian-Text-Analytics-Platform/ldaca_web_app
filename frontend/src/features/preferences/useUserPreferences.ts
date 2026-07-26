import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  getPreferences,
  updatePreferences,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { queryKeys } from '@/lib/queryKeys';

const DEFAULT_PREFERENCES: Required<UserPreferences> = {
  hidden_views: [],
  favorite_workspaces: [],
  analysis_multi_tab_enabled: false,
  contextual_hints_enabled: true,
};

export function useUserPreferences() {
  const userId = useAuth().user?.id ?? null;
  const query = useQuery({
    queryKey: queryKeys.userPreferences(userId),
    queryFn: async () => (await getPreferences({ throwOnError: true })).data,
    enabled: userId !== null,
  });

  return {
    data: query.data,
    error: query.error,
    isError: query.isError,
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
    preferences: query.data ?? DEFAULT_PREFERENCES,
    userId,
  };
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  const userId = useAuth().user?.id ?? null;
  const queryKey = queryKeys.userPreferences(userId);

  return useMutation({
    mutationFn: async (patch: UserPreferencesPatch) =>
      (await updatePreferences({ body: patch, throwOnError: true })).data,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<UserPreferences>(queryKey);
      if (previous) {
        queryClient.setQueryData<UserPreferences>(queryKey, {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error(error instanceof Error ? error.message : 'Could not save preferences');
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(queryKey, preferences);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
