import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  clearAnnotationProviderConfigurations,
  createAnnotationProviderConfiguration,
  deleteAnnotationProviderConfiguration,
  getProviderCredentials,
  updateAnnotationProviderConfiguration,
  updateDataPortalCredential,
} from '@/api';
import type {
  AnnotationProviderConfigurationResource,
  DataPortalCredentialPatchWritable,
  ProviderCredentialSummary,
} from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  normalizeCustomProviderBaseUrl,
  type AnnotationProviderConfigurationInput,
  type AnnotationProviderConfigurationUpdateInput,
  type AnnotationProviderConfigurationView,
  useBrowserProviderCredentialPresence,
  useProviderCredentialsStore,
} from './providerCredentialsStore';
import { queryKeys } from '@/lib/queryKeys';

const configurationView = (
  configuration: AnnotationProviderConfigurationResource,
): AnnotationProviderConfigurationView => ({
  ...configuration,
  credentialRevision: 1,
});

const normalizedCreateInput = (input: AnnotationProviderConfigurationInput) => {
  const name = input.name.trim();
  if (!name) throw new Error('Enter a provider name');
  const trimmedApiKey = input.apiKey?.trim() ?? '';
  const apiKey = trimmedApiKey.length > 0 ? trimmedApiKey : undefined;
  const baseUrl =
    input.provider === 'custom'
      ? normalizeCustomProviderBaseUrl(input.baseUrl?.trim() ?? '')
      : undefined;
  return { name, provider: input.provider, baseUrl, apiKey };
};

/** One UI facade over backend-owned local configurations and browser-owned hosted ones. */
export const useProviderCredentials = () => {
  const { isAuthenticated, isMultiUserMode, user } = useAuth();
  const queryClient = useQueryClient();
  const localPresence = useBrowserProviderCredentialPresence(user?.id);
  const statusQuery = useQuery({
    queryKey: queryKeys.providerCredentials,
    queryFn: async () => (await getProviderCredentials({ throwOnError: true })).data,
    enabled: isAuthenticated,
  });

  const updateBackendDataPortalCredential = async (patch: DataPortalCredentialPatchWritable) => {
    const { data } = await updateDataPortalCredential({ body: patch, throwOnError: true });
    queryClient.setQueryData(queryKeys.providerCredentials, data);
    return data;
  };

  const requireBrowserUser = (): string => {
    if (!user?.id) throw new Error('No authenticated user is available');
    return user.id;
  };

  const setBackendConfigurations = (
    transform: (
      configurations: AnnotationProviderConfigurationResource[],
    ) => AnnotationProviderConfigurationResource[],
  ) => {
    queryClient.setQueryData<ProviderCredentialSummary>(
      queryKeys.providerCredentials,
      (current) => {
        if (!current || current.annotation_providers === null) return current;
        return { ...current, annotation_providers: transform(current.annotation_providers) };
      },
    );
  };

  /** Drop only model and active Preview caches whose next request uses an edited key. */
  const invalidateAnnotationCredentialConsumers = (configurationId: string) => {
    queryClient.removeQueries({
      queryKey: queryKeys.annotationModelsForConfiguration(configurationId),
    });
    queryClient.removeQueries({
      predicate: (query) => {
        const projection = query.queryKey.at(-1);
        return (
          typeof projection === 'object' &&
          projection !== null &&
          'provider_configuration_id' in projection &&
          projection.provider_configuration_id === configurationId
        );
      },
    });
  };

  const addAnnotationProvider = async (
    input: AnnotationProviderConfigurationInput,
  ): Promise<AnnotationProviderConfigurationView> => {
    const normalized = normalizedCreateInput(input);
    if (isMultiUserMode) {
      return useProviderCredentialsStore.getState().addAnnotationProvider(requireBrowserUser(), {
        name: normalized.name,
        provider: normalized.provider,
        baseUrl: normalized.baseUrl,
        apiKey: normalized.apiKey,
      });
    }
    const { data } = await createAnnotationProviderConfiguration({
      body: {
        name: normalized.name,
        provider: normalized.provider,
        ...(normalized.baseUrl ? { base_url: normalized.baseUrl } : {}),
        ...(normalized.apiKey ? { api_key: normalized.apiKey } : {}),
      },
      throwOnError: true,
    });
    setBackendConfigurations((configurations) => [...configurations, data]);
    return configurationView(data);
  };

  const updateAnnotationProvider = async (
    configurationId: string,
    input: AnnotationProviderConfigurationUpdateInput,
  ) => {
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new Error('Enter a provider name');
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : input.apiKey;
    if (typeof apiKey === 'string' && !apiKey) {
      throw new Error('Enter an API key or use Remove saved key');
    }
    if (input.name === undefined && input.apiKey === undefined) {
      throw new Error('Change the name or API key before saving');
    }
    if (isMultiUserMode) {
      const updated = useProviderCredentialsStore
        .getState()
        .updateAnnotationProvider(requireBrowserUser(), configurationId, {
          ...(name !== undefined ? { name } : {}),
          ...(input.apiKey !== undefined ? { apiKey } : {}),
        });
      if (input.apiKey !== undefined) invalidateAnnotationCredentialConsumers(configurationId);
      return updated;
    }
    const { data } = await updateAnnotationProviderConfiguration({
      path: { configuration_id: configurationId },
      body: {
        ...(name !== undefined ? { name } : {}),
        ...(input.apiKey !== undefined ? { api_key: apiKey } : {}),
      },
      throwOnError: true,
    });
    setBackendConfigurations((configurations) =>
      configurations.map((configuration) =>
        configuration.id === configurationId ? data : configuration,
      ),
    );
    if (input.apiKey !== undefined) invalidateAnnotationCredentialConsumers(configurationId);
    return configurationView(data);
  };

  const deleteAnnotationProvider = async (configurationId: string) => {
    if (isMultiUserMode) {
      useProviderCredentialsStore
        .getState()
        .deleteAnnotationProvider(requireBrowserUser(), configurationId);
    } else {
      await deleteAnnotationProviderConfiguration({
        path: { configuration_id: configurationId },
        throwOnError: true,
      });
      setBackendConfigurations((configurations) =>
        configurations.filter((configuration) => configuration.id !== configurationId),
      );
    }
    invalidateAnnotationCredentialConsumers(configurationId);
  };

  const clearAnnotationProviders = async () => {
    if (isMultiUserMode) {
      useProviderCredentialsStore.getState().clearAnnotationProviders(requireBrowserUser());
    } else {
      await clearAnnotationProviderConfigurations({ throwOnError: true });
      setBackendConfigurations(() => []);
    }
    queryClient.removeQueries({ queryKey: queryKeys.annotationModels });
  };

  const saveDataPortalCredential = async (value: string) => {
    const credential = value.trim();
    if (!credential) throw new Error('Enter a Data Portal token');
    if (isMultiUserMode) {
      useProviderCredentialsStore
        .getState()
        .setDataPortalCredential(requireBrowserUser(), credential);
    } else {
      await updateBackendDataPortalCredential({ data_portal_api_token: credential });
    }
  };

  const clearDataPortalCredential = async () => {
    if (isMultiUserMode) {
      useProviderCredentialsStore.getState().clearDataPortalCredential(requireBrowserUser());
    } else {
      await updateBackendDataPortalCredential({ data_portal_api_token: null });
    }
  };

  const annotationProviders = isMultiUserMode
    ? localPresence.annotationProviders
    : (statusQuery.data?.annotation_providers ?? []).map(configurationView);
  const dataPortalUserConfigured = isMultiUserMode
    ? localPresence.dataPortal
    : (statusQuery.data?.data_portal.user_configured ?? false);

  return {
    storage: isMultiUserMode ? ('browser' as const) : ('backend' as const),
    annotationProviders,
    dataPortal: {
      userConfigured: dataPortalUserConfigured,
      deploymentConfigured: statusQuery.data?.data_portal.deployment_configured ?? false,
    },
    revision: isMultiUserMode ? localPresence.revision : statusQuery.dataUpdatedAt,
    isLoading: !isMultiUserMode && statusQuery.isLoading,
    error: !isMultiUserMode ? statusQuery.error : null,
    retry: statusQuery.refetch,
    addAnnotationProvider,
    updateAnnotationProvider,
    deleteAnnotationProvider,
    clearAnnotationProviders,
    saveDataPortalCredential,
    clearDataPortalCredential,
  };
};
