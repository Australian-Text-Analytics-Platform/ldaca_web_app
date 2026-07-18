import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  getPreferences,
  updatePreferences,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useDevicePreferencesStore } from '@/stores/preferencesStore';

export const userPreferencesKey = (userId: string | null) => ['user-preferences', userId] as const;

const DEFAULT_PREFERENCES: Required<UserPreferences> = {
  hidden_views: [],
  favorite_workspaces: [],
  default_tokenizer_model: null,
  analysis_multi_tab_enabled: false,
  contextual_hints_enabled: true,
};

export function useUserPreferences() {
  const userId = useAuth().user?.id ?? null;
  const query = useQuery({
    queryKey: userPreferencesKey(userId),
    queryFn: async () => (await getPreferences({ throwOnError: true })).data,
    enabled: userId !== null,
  });

  return {
    ...query,
    preferences: query.data ?? DEFAULT_PREFERENCES,
    userId,
  };
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  const userId = useAuth().user?.id ?? null;
  const queryKey = userPreferencesKey(userId);

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

/** Scopes device-only preferences to the current authenticated user. */
export function useDevicePreferencesInit() {
  const userId = useAuth().user?.id ?? null;
  const setDeviceUser = useDevicePreferencesStore((state) => state.setUser);

  useEffect(() => {
    setDeviceUser(userId);
  }, [setDeviceUser, userId]);
}
