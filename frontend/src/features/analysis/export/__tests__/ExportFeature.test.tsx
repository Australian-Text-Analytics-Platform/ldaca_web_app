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
  useWorkspaceSelection: () => ({
    selectedNodes: [
      {
        id: 'node-1',
        label: 'Node One',
        data: { nodeName: 'Node One' },
      },
    ],
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspaceId: 'ws-1',
    currentWorkspace: { name: 'Workspace One' },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
  }),
}));

vi.mock('@/lib/backend/env', () => ({
  getApiBase: () => 'http://api.test',
}));

vi.mock('@/components/help/HelpIcon', () => ({
  default: () => null,
}));

vi.mock('@/components/help/InfoIcon', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await import('react');
  const SelectContext = ReactModule.createContext<{
    value: string;
    onValueChange: (value: string) => void;
  } | null>(null);

  return {
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
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => {
      const context = ReactModule.useContext(SelectContext);
      if (!context) {
        throw new Error('SelectContent must be rendered inside Select');
      }
      return (
        <select
          aria-label="Format"
          value={context.value}
          onChange={(event) => context.onValueChange(event.target.value)}
        >
          {children}
        </select>
      );
    },
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
      blob: async () => new Blob(['parquet-bytes']),
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
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/workspaces/export?');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('format=parquet');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('format=csv');

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('download', 'Node One.parquet');
    expect(clickMock).toHaveBeenCalledTimes(1);
  });
});
