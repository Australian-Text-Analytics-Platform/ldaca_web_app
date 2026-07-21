import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PROVIDER_CREDENTIAL_STORAGE_KEY = 'wordflow-provider-credentials';
const PROVIDER_CREDENTIAL_STORAGE_VERSION = 1;

export type ProviderCredentialField =
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'google'
  | 'dataPortal';

interface StoredUserProviderCredentials {
  openai?: string;
  openrouter?: string;
  anthropic?: string;
  google?: string;
  dataPortal?: string;
  revision: number;
}

interface ProviderCredentialsState {
  byUser: Record<string, StoredUserProviderCredentials>;
}

interface ProviderCredentialsActions {
  setCredential: (userId: string, field: ProviderCredentialField, value: string) => void;
  clearCredential: (userId: string, field: ProviderCredentialField) => void;
  clearAnnotationCredentials: (userId: string) => void;
}

type ProviderCredentialsStore = ProviderCredentialsState & ProviderCredentialsActions;

export interface ProviderCredentialPresence {
  annotation: {
    openai: boolean;
    openrouter: boolean;
    anthropic: boolean;
    google: boolean;
  };
  dataPortal: boolean;
  revision: number;
}

const emptyPresence = (): ProviderCredentialPresence => ({
  annotation: {
    openai: false,
    openrouter: false,
    anthropic: false,
    google: false,
  },
  dataPortal: false,
  revision: 0,
});

const presenceFromEntry = (
  entry: StoredUserProviderCredentials | undefined,
): ProviderCredentialPresence => {
  if (!entry) return emptyPresence();
  return {
    annotation: {
      openai: Boolean(entry.openai),
      openrouter: Boolean(entry.openrouter),
      anthropic: Boolean(entry.anthropic),
      google: Boolean(entry.google),
    },
    dataPortal: Boolean(entry.dataPortal),
    revision: entry.revision,
  };
};

/** Browser-only provider secrets, intentionally kept outside Zustand devtools. */
export const useProviderCredentialsStore = create<ProviderCredentialsStore>()(
  persist(
    (set) => ({
      byUser: {},

      setCredential: (userId, field, value) => {
        if (!userId || !value) return;
        set((state) => {
          const current = state.byUser[userId] ?? { revision: 0 };
          if (current[field] === value) return state;
          return {
            byUser: {
              ...state.byUser,
              [userId]: {
                ...current,
                [field]: value,
                revision: current.revision + 1,
              },
            },
          };
        });
      },

      clearCredential: (userId, field) => {
        set((state) => {
          const current = state.byUser[userId];
          if (!current?.[field]) return state;
          const next = { ...current, [field]: undefined, revision: current.revision + 1 };
          return { byUser: { ...state.byUser, [userId]: next } };
        });
      },

      clearAnnotationCredentials: (userId) => {
        set((state) => {
          const current = state.byUser[userId];
          if (
            !current ||
            ![current.openai, current.openrouter, current.anthropic, current.google].some(Boolean)
          ) {
            return state;
          }
          const next = {
            ...current,
            openai: undefined,
            openrouter: undefined,
            anthropic: undefined,
            google: undefined,
            revision: current.revision + 1,
          };
          return { byUser: { ...state.byUser, [userId]: next } };
        });
      },
    }),
    {
      name: PROVIDER_CREDENTIAL_STORAGE_KEY,
      version: PROVIDER_CREDENTIAL_STORAGE_VERSION,
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
);

export const getBrowserProviderCredential = (
  userId: string | null | undefined,
  field: ProviderCredentialField,
): string | undefined =>
  userId ? useProviderCredentialsStore.getState().byUser[userId]?.[field] : undefined;

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

const sanitizeEntry = (value: unknown): StoredUserProviderCredentials | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const entry: StoredUserProviderCredentials = {
    revision:
      typeof source.revision === 'number' &&
      Number.isSafeInteger(source.revision) &&
      source.revision >= 0
        ? source.revision
        : 0,
  };
  for (const field of ['openai', 'openrouter', 'anthropic', 'google', 'dataPortal'] as const) {
    const credential = source[field];
    if (typeof credential === 'string' && credential.length > 0 && credential.length <= 4_000) {
      entry[field] = credential;
    }
  }
  return entry;
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
    const byUser = (state as Record<string, unknown>).byUser;
    if (!byUser || typeof byUser !== 'object' || Array.isArray(byUser)) return null;
    return Object.fromEntries(
      Object.entries(byUser).flatMap(([userId, value]) => {
        const entry = userId ? sanitizeEntry(value) : null;
        return entry ? [[userId, entry] as const] : [];
      }),
    );
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
