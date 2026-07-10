import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddFilePanel } from '../AddFilePanel';
import type * as DialogUi from '@/components/ui/dialog';

vi.mock('../../hooks/useFilePreview', () => ({
  useFilePreview: () => ({
    columns: [],
    error: null,
    fileType: 'csv',
    loading: false,
    previewData: [],
    selectedSheet: null,
    setSelectedSheet: vi.fn(),
    sheetNames: null,
  }),
}));

vi.mock('@/components/ui/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof DialogUi>();
  return {
    ...actual,
    /** Marks each real Dialog owner so the composition test can reject nested shells. */
    Dialog: ({ children, ...props }: ComponentProps<typeof actual.Dialog>) => (
      <div data-testid="dialog-owner">
        <actual.Dialog {...props}>{children}</actual.Dialog>
      </div>
    ),
  };
});

describe('AddFilePanel dialog ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses FilePreviewContent as the only dialog owner', () => {
    render(<AddFilePanel filename="records.csv" open onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getAllByTestId('dialog-owner')).toHaveLength(1);
  });
});
