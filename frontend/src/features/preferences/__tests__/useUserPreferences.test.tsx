import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  userPreferencesKey,
  useUpdateUserPreferences,
  useUserPreferences,
} from '../useUserPreferences';
import type { UserPreferences } from '@/api';

const fixture = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: fixture.userId ? { id: fixture.userId } : null }),
}));

vi.mock('@/api', () => {
  return {
    getPreferences: fixture.getPreferences,
    updatePreferences: fixture.updatePreferences,
  };
});

vi.mock('sonner', () => ({
  toast: { error: fixture.toastError },
}));

const preferences = (overrides: Partial<UserPreferences> = {}): UserPreferences => ({
  hidden_views: [],
  favorite_workspaces: [],
  default_tokenizer_model: null,
  analysis_multi_tab_enabled: false,
  contextual_hints_enabled: true,
  ...overrides,
});

function setupClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('user preferences hooks', () => {
  beforeEach(() => {
    fixture.userId = 'user-1';
    fixture.getPreferences.mockReset();
    fixture.updatePreferences.mockReset();
    fixture.toastError.mockReset();
    fixture.getPreferences.mockResolvedValue({ data: preferences() });
    fixture.updatePreferences.mockImplementation(({ body }: { body: Partial<UserPreferences> }) =>
      Promise.resolve({ data: preferences(body) }),
    );
    localStorage.clear();
  });

  it('scopes authoritative query data by authenticated user', async () => {
    const { client, wrapper } = setupClient();
    const view = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

    fixture.userId = 'user-2';
    fixture.getPreferences.mockResolvedValueOnce({
      data: preferences({ favorite_workspaces: ['workspace-2'] }),
    });
    view.rerender();
    await waitFor(() =>
      expect(view.result.current.preferences.favorite_workspaces).toEqual(['workspace-2']),
    );

    expect(client.getQueryData(userPreferencesKey('user-1'))).toEqual(preferences());
    expect(client.getQueryData(userPreferencesKey('user-2'))).toEqual(
      preferences({ favorite_workspaces: ['workspace-2'] }),
    );
  });

  it('optimistically updates and rolls back with a visible error', async () => {
    const { client, wrapper } = setupClient();
    client.setQueryData(userPreferencesKey('user-1'), preferences());
    let rejectUpdate: ((error: Error) => void) | undefined;
    fixture.updatePreferences.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const view = renderHook(() => useUpdateUserPreferences(), { wrapper });

    act(() => {
      view.result.current.mutate({ contextual_hints_enabled: false });
    });
    await waitFor(() =>
      expect(
        client.getQueryData<UserPreferences>(userPreferencesKey('user-1'))
          ?.contextual_hints_enabled,
      ).toBe(false),
    );
    act(() => {
      rejectUpdate?.(new Error('save failed'));
    });

    await waitFor(() =>
      expect(
        client.getQueryData<UserPreferences>(userPreferencesKey('user-1'))
          ?.contextual_hints_enabled,
      ).toBe(true),
    );
    expect(fixture.toastError).toHaveBeenCalledWith('save failed');
  });
});
