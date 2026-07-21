import { beforeEach, describe, expect, it } from 'vitest';

import {
  PROVIDER_CREDENTIAL_STORAGE_KEY,
  applyProviderCredentialStorageEvent,
  getBrowserProviderCredential,
  providerCredentialPresence,
  useProviderCredentialsStore,
} from '../providerCredentialsStore';

describe('providerCredentialsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useProviderCredentialsStore.setState({ byUser: {} });
  });

  it('persists a version 1 credential partition for each authenticated user', () => {
    const store = useProviderCredentialsStore.getState();
    store.setCredential('user-a', 'openai', 'user-a-secret');
    store.setCredential('user-b', 'openai', 'user-b-secret');
    store.setCredential('user-a', 'dataPortal', 'portal-secret');

    expect(getBrowserProviderCredential('user-a', 'openai')).toBe('user-a-secret');
    expect(getBrowserProviderCredential('user-b', 'openai')).toBe('user-b-secret');
    expect(getBrowserProviderCredential('user-a', 'dataPortal')).toBe('portal-secret');
    expect(providerCredentialPresence('user-a')).toMatchObject({
      annotation: { openai: true, openrouter: false, anthropic: false, google: false },
      dataPortal: true,
    });

    const persisted = JSON.parse(localStorage.getItem(PROVIDER_CREDENTIAL_STORAGE_KEY) ?? '{}') as {
      version?: number;
      state?: { byUser?: Record<string, unknown> };
    };
    expect(persisted.version).toBe(1);
    expect(Object.keys(persisted.state?.byUser ?? {})).toEqual(['user-a', 'user-b']);
  });

  it('rehydrates after reload and retains entries when authentication state changes', async () => {
    useProviderCredentialsStore.getState().setCredential('user-a', 'anthropic', 'reload-secret');
    const persisted = localStorage.getItem(PROVIDER_CREDENTIAL_STORAGE_KEY);

    useProviderCredentialsStore.setState({ byUser: {} });
    if (persisted) localStorage.setItem(PROVIDER_CREDENTIAL_STORAGE_KEY, persisted);
    await useProviderCredentialsStore.persist.rehydrate();

    expect(getBrowserProviderCredential('user-a', 'anthropic')).toBe('reload-secret');
    expect(providerCredentialPresence(null).annotation.anthropic).toBe(false);
    expect(getBrowserProviderCredential('user-a', 'anthropic')).toBe('reload-secret');
  });

  it('replaces and clears only the selected user credential', () => {
    const store = useProviderCredentialsStore.getState();
    store.setCredential('user-a', 'google', 'first-secret');
    store.setCredential('user-b', 'google', 'other-user-secret');
    const firstRevision = providerCredentialPresence('user-a').revision;

    store.setCredential('user-a', 'google', 'replacement-secret');
    expect(getBrowserProviderCredential('user-a', 'google')).toBe('replacement-secret');
    expect(providerCredentialPresence('user-a').revision).toBeGreaterThan(firstRevision);

    store.clearCredential('user-a', 'google');
    expect(getBrowserProviderCredential('user-a', 'google')).toBeUndefined();
    expect(getBrowserProviderCredential('user-b', 'google')).toBe('other-user-secret');
  });

  it('applies replacements and deletion from another browser tab', () => {
    applyProviderCredentialStorageEvent(
      new StorageEvent('storage', {
        key: PROVIDER_CREDENTIAL_STORAGE_KEY,
        newValue: JSON.stringify({
          version: 1,
          state: {
            byUser: {
              'user-a': { openrouter: 'cross-tab-secret', revision: 4 },
            },
          },
        }),
        storageArea: localStorage,
      }),
    );
    expect(getBrowserProviderCredential('user-a', 'openrouter')).toBe('cross-tab-secret');

    applyProviderCredentialStorageEvent(
      new StorageEvent('storage', {
        key: PROVIDER_CREDENTIAL_STORAGE_KEY,
        newValue: null,
        storageArea: localStorage,
      }),
    );
    expect(getBrowserProviderCredential('user-a', 'openrouter')).toBeUndefined();
  });
});
