import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationAiPreview } from '../../hooks/useAnnotationAiPreview';
import { AnnotationAiPreviewPanel } from '../AnnotationAiPreviewPanel';

const mocks = vi.hoisted(() => ({
  polarsExpressionApply: vi.fn(),
  setCell: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    polarsExpressionApply: mocks.polarsExpressionApply,
    setCell: mocks.setCell,
  }),
}));

const preview = ({
  labels,
  isFetching,
  isLoading = false,
  refetch = vi.fn(),
  rows,
  pageIndex = 0,
}: {
  labels: (string | null)[];
  isFetching: boolean;
  isLoading?: boolean;
  refetch?: ReturnType<typeof vi.fn>;
  rows?: Record<string, unknown>[];
  pageIndex?: number;
}) =>
  ({
    columns: { text: 'text', annotation: 'annotation' },
    page: {
      rows: isLoading
        ? []
        : (rows ?? [
            { text: 'First text', annotation: 'existing', review: 'replacement' },
            { text: 'Second text', annotation: null, review: 'previous correction' },
          ]),
      rowCount: isLoading ? 0 : 2,
      pagination: { pageIndex, pageSize: 20 },
      setPagination: vi.fn(),
      query: {
        isLoading,
        isError: false,
        isFetching,
        refetch,
      },
    },
    predictions: {
      labels,
      query: {
        isFetching,
        isError: false,
        error: null,
        refetch,
      },
    },
    comparison: {
      query: {
        isFetching: false,
        isError: false,
      },
    },
  }) as unknown as AnnotationAiPreview;

const emptyCorrection = () => ({
  nodeId: 'node-1',
  availableColumns: ['text', 'annotation', 'review'],
  column: null,
  classOptions: ['replacement', 'new value'],
  onColumnChange: vi.fn(),
});

function PreviewHarness({
  initialCorrectionColumn = null,
}: {
  initialCorrectionColumn?: string | null;
}) {
  const [correctionColumn, setCorrectionColumn] = useState(initialCorrectionColumn);
  return (
    <AnnotationAiPreviewPanel
      preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
      correction={{
        nodeId: 'node-1',
        availableColumns: ['text', 'annotation', 'review'],
        column: correctionColumn,
        classOptions: ['replacement', 'new value'],
        onColumnChange: setCorrectionColumn,
      }}
    />
  );
}

describe('AnnotationAiPreviewPanel', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.polarsExpressionApply.mockReset();
    mocks.setCell.mockReset();
    mocks.polarsExpressionApply.mockResolvedValue(undefined);
    mocks.setCell.mockResolvedValue(undefined);
  });

  it('uses the target column name and shows progress inside every pending cell', () => {
    render(
      <AnnotationAiPreviewPanel
        preview={preview({ labels: [null, null], isFetching: true })}
        correction={emptyCorrection()}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'annotation (preview)' })).toBeInTheDocument();
    expect(screen.queryByText('AI prediction')).not.toBeInTheDocument();
    expect(screen.queryByText('Annotating...')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status', { name: 'Predicting annotation' })).toHaveLength(2);
  });

  it('keeps the table framework mounted while the requested page is processing', () => {
    render(
      <AnnotationAiPreviewPanel
        preview={preview({ labels: [], isFetching: true, isLoading: true })}
        correction={emptyCorrection()}
      />,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'text' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'annotation (preview)' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Processing preview page' })).toBeInTheDocument();
    expect(screen.queryByText('Loading texts...')).not.toBeInTheDocument();
  });

  it('uses the shared analysis table frame', () => {
    render(
      <AnnotationAiPreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={emptyCorrection()}
      />,
    );

    expect(screen.getByTestId('analysis-table-scroll-area')).toBeInTheDocument();
  });

  it('compares preview predictions with selected columns on the current page only', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AnnotationAiPreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={emptyCorrection()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compare To' }));
    await user.click(screen.getByRole('checkbox', { name: 'review' }));
    await user.click(screen.getByRole('button', { name: 'Compare' }));

    expect(
      screen.getByRole('heading', { name: 'annotation (preview) vs review' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'annotation (preview) replacement, review replacement: 1 rows',
      }),
    ).toBeInTheDocument();

    rerender(
      <AnnotationAiPreviewPanel
        preview={preview({
          labels: ['new value'],
          isFetching: false,
          pageIndex: 1,
          rows: [{ text: 'Third text', annotation: null, review: 'replacement' }],
        })}
        correction={emptyCorrection()}
      />,
    );

    expect(
      screen.getByRole('img', {
        name: 'annotation (preview) new value, review replacement: 1 rows',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('img', {
        name: 'annotation (preview) replacement, review replacement: 1 rows',
      }),
    ).not.toBeInTheDocument();
  });

  it('shows an original annotation changing to its preview prediction', () => {
    render(
      <AnnotationAiPreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={emptyCorrection()}
      />,
    );

    expect(screen.getByText('existing')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'changes to' })).toBeInTheDocument();
    expect(screen.getByText('replacement')).toBeInTheDocument();
    expect(screen.getByText('new value')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Predicting annotation' })).not.toBeInTheDocument();
  });

  it('always shows a persisted correction even when it equals the preview prediction', () => {
    render(<PreviewHarness initialCorrectionColumn="review" />);

    const firstRow = screen.getByRole('row', { name: /First text/ });
    expect(within(firstRow).getByRole('img', { name: 'corrected to' })).toBeInTheDocument();
    expect(within(firstRow).getAllByText('replacement')).toHaveLength(2);
  });

  it('refreshes only the visible preview page from the lower-right action', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn().mockResolvedValue(undefined);
    render(
      <AnnotationAiPreviewPanel
        preview={preview({
          labels: ['replacement', 'new value'],
          isFetching: false,
          refetch,
        })}
        correction={emptyCorrection()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Refresh page' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('asks for a correction column, then writes a selected correction into that cell', async () => {
    const user = userEvent.setup();
    render(<PreviewHarness />);

    const prediction = screen.getByRole('button', { name: 'Correct prediction for row 1' });
    expect(prediction).toHaveTextContent('replacement');
    await user.click(prediction);

    expect(
      screen.getByRole('heading', { name: 'Select user correction column' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'User Correction Column' }));
    expect(screen.queryByRole('option', { name: 'text' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'annotation' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'review' }));

    expect(
      screen.getByRole('columnheader', {
        name: 'annotation (preview) changes to Correction: review',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Correct prediction for row 1' }));
    await user.click(screen.getByRole('option', { name: 'new value' }));

    await waitFor(() => {
      expect(mocks.setCell).toHaveBeenCalledWith('node-1', 'review', 0, 'new value');
    });
    const firstRow = screen.getByRole('row', { name: /First text/ });
    expect(within(firstRow).getByText('replacement')).toBeInTheDocument();
    expect(within(firstRow).getByText('new value')).toBeInTheDocument();
  });

  it('creates and auto-selects a new correction column from the setup dialog', async () => {
    const user = userEvent.setup();
    render(<PreviewHarness />);

    await user.click(screen.getByRole('button', { name: 'Correct prediction for row 1' }));
    await user.click(screen.getByRole('combobox', { name: 'User Correction Column' }));
    await user.click(screen.getByRole('option', { name: 'Add new column' }));

    expect(screen.getByRole('heading', { name: 'Create correction column' })).toBeInTheDocument();
    const columnName = screen.getByRole('textbox', { name: 'Correction column name' });
    expect(columnName).toHaveAttribute('placeholder', 'annotation.correction');
    await user.click(columnName);
    await user.tab();
    expect(columnName).toHaveValue('annotation.correction');
    expect(columnName).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mocks.polarsExpressionApply).toHaveBeenCalledWith(
        'node-1',
        {
          context: 'with_columns',
          expressions: [
            {
              expression: {
                op: 'cast',
                operand: { op: 'literal', value: null },
                dtype: 'string',
                strict: false,
              },
              alias: 'annotation.correction',
            },
          ],
          group_by: [],
          name: null,
        },
        'update',
      );
    });
    expect(
      screen.getByRole('columnheader', {
        name: 'annotation (preview) changes to Correction: annotation.correction',
      }),
    ).toBeInTheDocument();
  });
});
