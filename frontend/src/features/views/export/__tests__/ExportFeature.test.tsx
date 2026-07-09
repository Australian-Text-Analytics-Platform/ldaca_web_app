import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ExportFeature from '../ExportFeature';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  // Supplies a selected node so export actions have a concrete target.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useWorkspaceSelection: () => ({
    selectedNodes: [
      {
        id: 'node-1',
        name: 'Node One',
      },
    ],
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  // Provides workspace identity used to compose export URLs and archive names.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useWorkspaceData: () => ({
    currentWorkspaceId: 'ws-1',
    currentWorkspace: { name: 'Workspace One' },
  }),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  // Supplies stable auth headers for expected fetch arguments.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useAuth: () => ({
    // Mirrors the real hook contract without needing an authenticated session.
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
  }),
}));

vi.mock('@/lib/backend/env', () => ({
  // Fixes the backend origin so URL assertions stay deterministic.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  getApiBase: () => 'http://api.test',
}));

vi.mock('@/components/help/HelpIcon', () => ({
  // Removes help chrome from tests focused on export behavior.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => null,
}));

vi.mock('@/components/help/InfoIcon', () => ({
  // Removes info chrome from tests focused on export behavior.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => null,
}));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await import('react');
  const SelectContext = ReactModule.createContext<{
    value: string;
    onValueChange: (value: string) => void;
  } | null>(null);

  return {
    // Keeps the select stateful enough for format-change tests without Radix internals.
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    // Renders trigger content plainly because interaction happens through the native select.
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    // Avoids placeholder rendering that is irrelevant to export assertions.
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    SelectValue: () => null,
    // Replaces the Radix popup with a native select for accessible test interaction.
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    SelectContent: ({ children }: { children: React.ReactNode }) => {
      const context = ReactModule.useContext(SelectContext);
      if (!context) {
        throw new Error('SelectContent must be rendered inside Select');
      }
      return (
        <select
          aria-label="Format"
          value={context.value}
          onChange={(event) => {
            context.onValueChange(event.target.value);
          }}
        >
          {children}
        </select>
      );
    },
    // Maps each mocked item to a native option consumed by SelectContent.
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

describe('ExportFeature', () => {
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;
  let clickMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURLMock = vi.fn(() => 'blob:export');
    revokeObjectURLMock = vi.fn();
    clickMock = vi.fn();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      // Provides export bytes to the component's download branch.
      // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
      blob: () => new Blob(['parquet-bytes']),
    });

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURLMock,
    });

    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock,
    });

    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: clickMock,
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('passes the selected bulk export format through to the backend request', async () => {
    render(<ExportFeature />);

    expect(screen.getByText('Selected Data Blocks')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), {
      target: { value: 'parquet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export All (ZIP bundle)' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://api.test/api/workspaces/ws-1/export?node_ids=node-1&format=parquet',
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('download', 'Node One.parquet');
    expect(clickMock).toHaveBeenCalledTimes(1);
  });
});
