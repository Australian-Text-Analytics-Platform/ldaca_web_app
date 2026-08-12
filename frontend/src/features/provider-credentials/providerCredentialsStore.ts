import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AnnotationProviderConfigurationResource } from '@/api';

export const PROVIDER_CREDENTIAL_STORAGE_KEY = 'wordflow-provider-credentials';
const PROVIDER_CREDENTIAL_STORAGE_VERSION = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AnnotationProviderType = AnnotationProviderConfigurationResource['provider'];

export interface AnnotationProviderConfigurationInput {
  name: string;
  provider: AnnotationProviderType;
  baseUrl?: string | null;
  apiKey?: string | null;
}

export interface AnnotationProviderConfigurationUpdateInput {
  name?: string;
  /** Omission keeps the key; null removes it; a non-empty string replaces it. */
  apiKey?: string | null;
}

export interface AnnotationProviderConfigurationView
  extends AnnotationProviderConfigurationResource {
  credentialRevision: number;
}

interface StoredAnnotationProviderConfiguration {
  id: string;
  name: string;
  provider: AnnotationProviderType;
  baseUrl?: string;
  apiKey?: string;
  credentialRevision: number;
}

interface StoredUserProviderCredentials {
  annotationProviders: StoredAnnotationProviderConfiguration[];
  dataPortal?: string;
  revision: number;
}

interface ProviderCredentialsState {
  byUser: Record<string, StoredUserProviderCredentials>;
}

interface ProviderCredentialsActions {
  addAnnotationProvider: (
    userId: string,
    input: AnnotationProviderConfigurationInput,
  ) => AnnotationProviderConfigurationView;
  updateAnnotationProvider: (
    userId: string,
    configurationId: string,
    input: AnnotationProviderConfigurationUpdateInput,
  ) => AnnotationProviderConfigurationView;
  deleteAnnotationProvider: (userId: string, configurationId: string) => void;
  clearAnnotationProviders: (userId: string) => void;
  setDataPortalCredential: (userId: string, value: string) => void;
  clearDataPortalCredential: (userId: string) => void;
}

type ProviderCredentialsStore = ProviderCredentialsState & ProviderCredentialsActions;

export interface ProviderCredentialPresence {
  annotationProviders: AnnotationProviderConfigurationView[];
  dataPortal: boolean;
  revision: number;
}

const emptyEntry = (): StoredUserProviderCredentials => ({
  annotationProviders: [],
  revision: 0,
});

const emptyPresence = (): ProviderCredentialPresence => ({
  annotationProviders: [],
  dataPortal: false,
  revision: 0,
});

const configurationView = (
  configuration: StoredAnnotationProviderConfiguration,
): AnnotationProviderConfigurationView => ({
  id: configuration.id,
  name: configuration.name,
  provider: configuration.provider,
  base_url: configuration.baseUrl ?? null,
  has_api_key: Boolean(configuration.apiKey),
  credentialRevision: configuration.credentialRevision,
});

const presenceFromEntry = (
  entry: StoredUserProviderCredentials | undefined,
): ProviderCredentialPresence => {
  if (!entry) return emptyPresence();
  return {
    annotationProviders: entry.annotationProviders.map(configurationView),
    dataPortal: Boolean(entry.dataPortal),
    revision: entry.revision,
  };
};

const providerTypes = new Set<AnnotationProviderType>([
  'openrouter',
  'openai',
  'anthropic',
  'google',
  'custom',
]);

const isProviderType = (value: unknown): value is AnnotationProviderType =>
  typeof value === 'string' && providerTypes.has(value as AnnotationProviderType);

export const normalizeCustomProviderBaseUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Enter an absolute HTTP or HTTPS Custom Base URL');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Custom Base URL must be HTTP(S) with no user information, query, or fragment');
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
};

const normalizeConfigurationInput = (
  input: AnnotationProviderConfigurationInput,
): Omit<StoredAnnotationProviderConfiguration, 'id' | 'credentialRevision'> => {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new Error('Enter a provider name');
  const trimmedApiKey = input.apiKey?.trim() ?? '';
  const apiKey = trimmedApiKey.length > 0 ? trimmedApiKey : undefined;
  if (trimmedApiKey.length > 4_000) throw new Error('API key is too long');
  if (input.provider === 'custom') {
    if (!input.baseUrl?.trim()) throw new Error('Enter a Custom Base URL');
    return {
      name,
      provider: input.provider,
      baseUrl: normalizeCustomProviderBaseUrl(input.baseUrl),
      apiKey,
    };
  }
  if (input.baseUrl) throw new Error('Built-in providers cannot define a Custom Base URL');
  return { name, provider: input.provider, apiKey };
};

/** Browser-owned provider secrets, intentionally kept outside Zustand devtools. */
export const useProviderCredentialsStore = create<ProviderCredentialsStore>()(
  persist(
    (set, get) => ({
      byUser: {},

      addAnnotationProvider: (userId, input) => {
        if (!userId) throw new Error('No authenticated user is available');
        const normalized = normalizeConfigurationInput(input);
        const current = get().byUser[userId] ?? emptyEntry();
        const configuration: StoredAnnotationProviderConfiguration = {
          ...normalized,
          id: crypto.randomUUID(),
          credentialRevision: 1,
        };
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: {
              ...current,
              annotationProviders: [...current.annotationProviders, configuration],
              revision: current.revision + 1,
            },
          },
        }));
        return configurationView(configuration);
      },

      updateAnnotationProvider: (userId, configurationId, input) => {
        if (input.name === undefined && input.apiKey === undefined) {
          throw new Error('Change the name or API key before saving');
        }
        const trimmedName = input.name?.trim();
        if (input.name !== undefined && (!trimmedName || trimmedName.length > 200)) {
          throw new Error('Enter a provider name');
        }
        const trimmedApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : input.apiKey;
        if (typeof trimmedApiKey === 'string' && !trimmedApiKey) {
          throw new Error('Enter an API key or use Remove saved key');
        }
        if (typeof trimmedApiKey === 'string' && trimmedApiKey.length > 4_000) {
          throw new Error('API key is too long');
        }
        const current = get().byUser[userId];
        if (!current) throw new Error('Annotation provider configuration not found');
        const existing = current.annotationProviders.find(
          (configuration) => configuration.id === configurationId,
        );
        if (!existing) {
          throw new Error('Annotation provider configuration not found');
        }
        const annotationProviders = current.annotationProviders.map((configuration) => {
          if (configuration.id !== configurationId) return configuration;
          const apiKey =
            trimmedApiKey === null ? undefined : (trimmedApiKey ?? configuration.apiKey);
          const credentialChanged = input.apiKey !== undefined && apiKey !== configuration.apiKey;
          return {
            ...configuration,
            name: trimmedName ?? configuration.name,
            apiKey,
            credentialRevision: credentialChanged
              ? configuration.credentialRevision + 1
              : configuration.credentialRevision,
          };
        });
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: { ...current, annotationProviders, revision: current.revision + 1 },
          },
        }));
        const updated = annotationProviders.find(
          (configuration) => configuration.id === configurationId,
        );
        if (!updated) throw new Error('Annotation provider configuration not found');
        return configurationView(updated);
      },

      deleteAnnotationProvider: (userId, configurationId) => {
        const current = get().byUser[userId];
        if (!current) throw new Error('Annotation provider configuration not found');
        const annotationProviders = current.annotationProviders.filter(
          (configuration) => configuration.id !== configurationId,
        );
        if (annotationProviders.length === current.annotationProviders.length) {
          throw new Error('Annotation provider configuration not found');
        }
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: { ...current, annotationProviders, revision: current.revision + 1 },
          },
        }));
      },

      clearAnnotationProviders: (userId) => {
        const current = get().byUser[userId];
        if (!current || current.annotationProviders.length === 0) return;
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: { ...current, annotationProviders: [], revision: current.revision + 1 },
          },
        }));
      },

      setDataPortalCredential: (userId, value) => {
        const credential = value.trim();
        if (!userId || !credential) return;
        set((state) => {
          const current = state.byUser[userId] ?? emptyEntry();
          if (current.dataPortal === credential) return state;
          return {
            byUser: {
              ...state.byUser,
              [userId]: {
                ...current,
                dataPortal: credential,
                revision: current.revision + 1,
              },
            },
          };
        });
      },

      clearDataPortalCredential: (userId) => {
        set((state) => {
          const current = state.byUser[userId];
          if (!current?.dataPortal) return state;
          return {
            byUser: {
              ...state.byUser,
              [userId]: {
                ...current,
                dataPortal: undefined,
                revision: current.revision + 1,
              },
            },
          };
        });
      },
    }),
    {
      name: PROVIDER_CREDENTIAL_STORAGE_KEY,
      version: PROVIDER_CREDENTIAL_STORAGE_VERSION,
      partialize: (state) => ({ byUser: state.byUser }),
      merge: (persisted, current) => ({
        ...current,
        byUser:
          sanitizePartitions((persisted as { byUser?: unknown } | null | undefined)?.byUser) ?? {},
      }),
    },
  ),
);

export const getBrowserAnnotationProviderCredential = (
  userId: string | null | undefined,
  configurationId: string,
): string | undefined => {
  if (!userId) return undefined;
  return useProviderCredentialsStore
    .getState()
    .byUser[userId]?.annotationProviders.find((item) => item.id === configurationId)?.apiKey;
};

export const getBrowserDataPortalCredential = (
  userId: string | null | undefined,
): string | undefined =>
  userId ? useProviderCredentialsStore.getState().byUser[userId]?.dataPortal : undefined;

export const providerCredentialPresence = (
  userId: string | null | undefined,
): ProviderCredentialPresence =>
  presenceFromEntry(userId ? useProviderCredentialsStore.getState().byUser[userId] : undefined);

export const useBrowserProviderCredentialPresence = (
  userId: string | null | undefined,
): ProviderCredentialPresence => {
  const entry = useProviderCredentialsStore((state) => (userId ? state.byUser[userId] : undefined));
  return presenceFromEntry(entry);
};

const sanitizeConfiguration = (value: unknown): StoredAnnotationProviderConfiguration | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.id !== 'string' ||
    !UUID_PATTERN.test(source.id) ||
    typeof source.name !== 'string' ||
    source.name.trim().length === 0 ||
    source.name.length > 200 ||
    !isProviderType(source.provider) ||
    typeof source.credentialRevision !== 'number' ||
    !Number.isSafeInteger(source.credentialRevision) ||
    source.credentialRevision < 1
  ) {
    return null;
  }
  const apiKey =
    typeof source.apiKey === 'string' && source.apiKey.length > 0 && source.apiKey.length <= 4_000
      ? source.apiKey
      : undefined;
  let baseUrl: string | undefined;
  if (source.provider === 'custom') {
    if (typeof source.baseUrl !== 'string') return null;
    try {
      baseUrl = normalizeCustomProviderBaseUrl(source.baseUrl);
    } catch {
      return null;
    }
  } else if (source.baseUrl !== undefined) {
    return null;
  }
  return {
    id: source.id,
    name: source.name.trim(),
    provider: source.provider,
    baseUrl,
    apiKey,
    credentialRevision: source.credentialRevision,
  };
};

const sanitizeEntry = (value: unknown): StoredUserProviderCredentials | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.annotationProviders)) return null;
  const annotationProviders = source.annotationProviders.map(sanitizeConfiguration);
  if (annotationProviders.some((item) => item === null)) return null;
  const configurations = annotationProviders as StoredAnnotationProviderConfiguration[];
  if (new Set(configurations.map((item) => item.id)).size !== configurations.length) {
    return null;
  }
  const dataPortal =
    typeof source.dataPortal === 'string' &&
    source.dataPortal.length > 0 &&
    source.dataPortal.length <= 4_000
      ? source.dataPortal
      : undefined;
  if (
    typeof source.revision !== 'number' ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0
  ) {
    return null;
  }
  return { annotationProviders: configurations, dataPortal, revision: source.revision };
};

const sanitizePartitions = (
  value: unknown,
): Record<string, StoredUserProviderCredentials> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, StoredUserProviderCredentials> = {};
  for (const [userId, entryValue] of Object.entries(value)) {
    const entry = userId ? sanitizeEntry(entryValue) : null;
    if (!entry) return null;
    result[userId] = entry;
  }
  return result;
};

const parseStoredPartitions = (
  serialized: string,
): Record<string, StoredUserProviderCredentials> | null => {
  try {
    const payload = JSON.parse(serialized) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const envelope = payload as Record<string, unknown>;
    if (envelope.version !== PROVIDER_CREDENTIAL_STORAGE_VERSION) return null;
    const state = envelope.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
    return sanitizePartitions((state as Record<string, unknown>).byUser);
  } catch {
    return null;
  }
};

/** Applies the browser storage event that other tabs receive after replacement or deletion. */
export const applyProviderCredentialStorageEvent = (event: StorageEvent) => {
  if (event.key !== PROVIDER_CREDENTIAL_STORAGE_KEY) return;
  if (event.storageArea && event.storageArea !== window.localStorage) return;
  if (event.newValue === null) {
    useProviderCredentialsStore.setState({ byUser: {} });
    return;
  }
  const byUser = parseStoredPartitions(event.newValue);
  if (byUser) useProviderCredentialsStore.setState({ byUser });
};

export const startProviderCredentialStorageSync = () => {
  window.addEventListener('storage', applyProviderCredentialStorageEvent);
  return () => {
    window.removeEventListener('storage', applyProviderCredentialStorageEvent);
  };
};
