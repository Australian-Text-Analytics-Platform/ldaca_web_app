import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getProviderCredentials, updateProviderCredentials } from '@/api';
import type { AnnotationCredentialStatus, ProviderCredentialPatchWritable } from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  useBrowserProviderCredentialPresence,
  useProviderCredentialsStore,
} from './providerCredentialsStore';

const PROVIDER_CREDENTIALS_QUERY_KEY = ['provider-credentials'] as const;
const ANNOTATION_MODELS_QUERY_KEY = ['annotation-ai-models'] as const;

export type AnnotationProviderId = keyof AnnotationCredentialStatus;

const PATCH_FIELD_BY_PROVIDER: Record<AnnotationProviderId, keyof ProviderCredentialPatchWritable> =
  {
    openai: 'openai_api_key',
    openrouter: 'openrouter_api_key',
    anthropic: 'anthropic_api_key',
    google: 'google_api_key',
  };

const emptyAnnotationStatus = (): AnnotationCredentialStatus => ({
  openai: false,
  openrouter: false,
  anthropic: false,
  google: false,
});

/** One UI facade over backend-owned local credentials and browser-owned hosted credentials. */
export const useProviderCredentials = () => {
  const { isAuthenticated, isMultiUserMode, user } = useAuth();
  const queryClient = useQueryClient();
  const localPresence = useBrowserProviderCredentialPresence(user?.id);
  const statusQuery = useQuery({
    queryKey: PROVIDER_CREDENTIALS_QUERY_KEY,
    queryFn: async () => (await getProviderCredentials({ throwOnError: true })).data,
    enabled: isAuthenticated,
  });

  const updateBackend = async (patch: ProviderCredentialPatchWritable) => {
    const { data } = await updateProviderCredentials({ body: patch, throwOnError: true });
    queryClient.setQueryData(PROVIDER_CREDENTIALS_QUERY_KEY, data);
    return data;
  };

  const requireBrowserUser = (): string => {
    if (!user?.id) throw new Error('No authenticated user is available');
    return user.id;
  };

  const saveAnnotationCredential = async (provider: AnnotationProviderId, value: string) => {
    const credential = value.trim();
    if (!credential) throw new Error('Enter a provider credential');
    if (isMultiUserMode) {
      useProviderCredentialsStore
        .getState()
        .setCredential(requireBrowserUser(), provider, credential);
    } else {
      await updateBackend({ [PATCH_FIELD_BY_PROVIDER[provider]]: credential });
    }
    await queryClient.invalidateQueries({ queryKey: ANNOTATION_MODELS_QUERY_KEY });
  };

  const clearAnnotationCredential = async (provider: AnnotationProviderId) => {
    if (isMultiUserMode) {
      useProviderCredentialsStore.getState().clearCredential(requireBrowserUser(), provider);
    } else {
      await updateBackend({ [PATCH_FIELD_BY_PROVIDER[provider]]: null });
    }
    await queryClient.invalidateQueries({ queryKey: ANNOTATION_MODELS_QUERY_KEY });
  };

  const clearAnnotationCredentials = async () => {
    if (isMultiUserMode) {
      useProviderCredentialsStore.getState().clearAnnotationCredentials(requireBrowserUser());
    } else {
      await updateBackend({
        openai_api_key: null,
        openrouter_api_key: null,
        anthropic_api_key: null,
        google_api_key: null,
      });
    }
    await queryClient.invalidateQueries({ queryKey: ANNOTATION_MODELS_QUERY_KEY });
  };

  const saveDataPortalCredential = async (value: string) => {
    const credential = value.trim();
    if (!credential) throw new Error('Enter a Data Portal token');
    if (isMultiUserMode) {
      useProviderCredentialsStore
        .getState()
        .setCredential(requireBrowserUser(), 'dataPortal', credential);
    } else {
      await updateBackend({ data_portal_api_token: credential });
    }
  };

  const clearDataPortalCredential = async () => {
    if (isMultiUserMode) {
      useProviderCredentialsStore.getState().clearCredential(requireBrowserUser(), 'dataPortal');
    } else {
      await updateBackend({ data_portal_api_token: null });
    }
  };

  const annotation = isMultiUserMode
    ? localPresence.annotation
    : (statusQuery.data?.annotation ?? emptyAnnotationStatus());
  const dataPortalUserConfigured = isMultiUserMode
    ? localPresence.dataPortal
    : (statusQuery.data?.data_portal.user_configured ?? false);

  return {
    storage: isMultiUserMode ? ('browser' as const) : ('backend' as const),
    annotation,
    dataPortal: {
      userConfigured: dataPortalUserConfigured,
      deploymentConfigured: statusQuery.data?.data_portal.deployment_configured ?? false,
    },
    revision: isMultiUserMode ? localPresence.revision : statusQuery.dataUpdatedAt,
    isLoading: statusQuery.isLoading,
    error: statusQuery.error,
    saveAnnotationCredential,
    clearAnnotationCredential,
    clearAnnotationCredentials,
    saveDataPortalCredential,
    clearDataPortalCredential,
  };
};
