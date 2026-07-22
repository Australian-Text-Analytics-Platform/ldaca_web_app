import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROVIDER_CREDENTIAL_STORAGE_KEY,
  applyProviderCredentialStorageEvent,
  getBrowserAnnotationProviderCredential,
  getBrowserDataPortalCredential,
  providerCredentialPresence,
  useProviderCredentialsStore,
} from '../providerCredentialsStore';

const FIRST_ID = '74a93227-c081-4db9-af2e-ad357b62278d';
const SECOND_ID = 'aa0295d2-c879-40a0-95b5-24c33fd28a43';

describe('providerCredentialsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useProviderCredentialsStore.setState({ byUser: {} });
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(FIRST_ID).mockReturnValueOnce(SECOND_ID);
  });

  it('persists ordered version 2 configurations in authenticated-user partitions', () => {
    const store = useProviderCredentialsStore.getState();
    const personal = store.addAnnotationProvider('user-a', {
      name: 'OpenRouter personal',
      provider: 'openrouter',
      apiKey: 'personal-secret',
    });
    const organisation = store.addAnnotationProvider('user-a', {
      name: 'OpenRouter organisation',
      provider: 'openrouter',
      apiKey: 'organisation-secret',
    });
    store.setDataPortalCredential('user-a', 'portal-secret');
    store.addAnnotationProvider('user-b', {
      name: 'OpenAI',
      provider: 'openai',
      apiKey: 'other-user-secret',
    });

    expect(providerCredentialPresence('user-a').annotationProviders).toEqual([
      personal,
      organisation,
    ]);
    expect(getBrowserAnnotationProviderCredential('user-a', personal.id)).toBe('personal-secret');
    expect(getBrowserAnnotationProviderCredential('user-b', personal.id)).toBeUndefined();
    expect(getBrowserDataPortalCredential('user-a')).toBe('portal-secret');

    const persisted = JSON.parse(localStorage.getItem(PROVIDER_CREDENTIAL_STORAGE_KEY) ?? '{}') as {
      version?: number;
      state?: { byUser?: Record<string, unknown> };
    };
    expect(persisted.version).toBe(2);
    expect(Object.keys(persisted.state?.byUser ?? {})).toEqual(['user-a', 'user-b']);
  });

  it('allows duplicate names but rejects duplicate semantic identities', () => {
    const store = useProviderCredentialsStore.getState();
    store.addAnnotationProvider('user-a', {
      name: 'OpenRouter',
      provider: 'openrouter',
      apiKey: 'first-key',
    });
    expect(() =>
      store.addAnnotationProvider('user-a', {
        name: 'OpenRouter',
        provider: 'openrouter',
        apiKey: 'second-key',
      }),
    ).not.toThrow();
    expect(() =>
      store.addAnnotationProvider('user-a', {
        name: 'Another name',
        provider: 'openrouter',
        apiKey: 'first-key',
      }),
    ).toThrow('already configured');
  });

  it('stores a normalized keyless Custom configuration', () => {
    const configuration = useProviderCredentialsStore.getState().addAnnotationProvider('user-a', {
      name: 'Local model',
      provider: 'custom',
      baseUrl: 'http://127.0.0.1:8080/v1/',
      apiKey: '',
    });

    expect(configuration).toMatchObject({
      provider: 'custom',
      base_url: 'http://127.0.0.1:8080/v1',
      has_api_key: false,
    });
    expect(getBrowserAnnotationProviderCredential('user-a', configuration.id)).toBeUndefined();
  });

  it('renames, deletes, and clears without changing another account', () => {
    const store = useProviderCredentialsStore.getState();
    const first = store.addAnnotationProvider('user-a', {
      name: 'First',
      provider: 'openai',
      apiKey: 'first-key',
    });
    const second = store.addAnnotationProvider('user-a', {
      name: 'Second',
      provider: 'openrouter',
      apiKey: 'second-key',
    });
    const other = store.addAnnotationProvider('user-b', {
      name: 'Other',
      provider: 'anthropic',
      apiKey: 'other-key',
    });

    store.renameAnnotationProvider('user-a', second.id, 'First');
    expect(
      providerCredentialPresence('user-a').annotationProviders.map((item) => item.name),
    ).toEqual(['First', 'First']);
    store.deleteAnnotationProvider('user-a', first.id);
    expect(providerCredentialPresence('user-a').annotationProviders.map((item) => item.id)).toEqual(
      [second.id],
    );
    store.clearAnnotationProviders('user-a');
    expect(providerCredentialPresence('user-a').annotationProviders).toEqual([]);
    expect(providerCredentialPresence('user-b').annotationProviders).toEqual([other]);
  });

  it('rehydrates version 2 and ignores version 1 without migration', async () => {
    useProviderCredentialsStore.getState().addAnnotationProvider('user-a', {
      name: 'Anthropic',
      provider: 'anthropic',
      apiKey: 'reload-secret',
    });
    const persisted = localStorage.getItem(PROVIDER_CREDENTIAL_STORAGE_KEY);

    useProviderCredentialsStore.setState({ byUser: {} });
    if (persisted) localStorage.setItem(PROVIDER_CREDENTIAL_STORAGE_KEY, persisted);
    await useProviderCredentialsStore.persist.rehydrate();
    expect(providerCredentialPresence('user-a').annotationProviders).toHaveLength(1);

    applyProviderCredentialStorageEvent(
      new StorageEvent('storage', {
        key: PROVIDER_CREDENTIAL_STORAGE_KEY,
        newValue: JSON.stringify({ version: 1, state: { byUser: { 'user-a': {} } } }),
        storageArea: localStorage,
      }),
    );
    expect(providerCredentialPresence('user-a').annotationProviders).toHaveLength(1);
  });

  it('rejects incomplete version 2 partitions instead of defaulting legacy fields', () => {
    useProviderCredentialsStore.getState().addAnnotationProvider('user-a', {
      name: 'OpenRouter',
      provider: 'openrouter',
      apiKey: 'current-secret',
    });

    applyProviderCredentialStorageEvent(
      new StorageEvent('storage', {
        key: PROVIDER_CREDENTIAL_STORAGE_KEY,
        newValue: JSON.stringify({
          version: 2,
          state: {
            byUser: {
              'user-a': {
                annotationProviders: [],
              },
            },
          },
        }),
        storageArea: localStorage,
      }),
    );

    expect(providerCredentialPresence('user-a').annotationProviders).toHaveLength(1);
  });

  it('applies valid version 2 replacement and deletion events from another tab', () => {
    applyProviderCredentialStorageEvent(
      new StorageEvent('storage', {
        key: PROVIDER_CREDENTIAL_STORAGE_KEY,
        newValue: JSON.stringify({
          version: 2,
          state: {
            byUser: {
              'user-a': {
                annotationProviders: [
                  {
                    id: FIRST_ID,
                    name: 'Cross-tab',
                    provider: 'openrouter',
                    apiKey: 'cross-tab-secret',
                    credentialRevision: 1,
                  },
                ],
                revision: 4,
              },
            },
          },
        }),
        storageArea: localStorage,
      }),
    );
    expect(getBrowserAnnotationProviderCredential('user-a', FIRST_ID)).toBe('cross-tab-secret');

    applyProviderCredentialStorageEvent(
      new StorageEvent('storage', {
        key: PROVIDER_CREDENTIAL_STORAGE_KEY,
        newValue: null,
        storageArea: localStorage,
      }),
    );
    expect(providerCredentialPresence('user-a').annotationProviders).toEqual([]);
  });
});
