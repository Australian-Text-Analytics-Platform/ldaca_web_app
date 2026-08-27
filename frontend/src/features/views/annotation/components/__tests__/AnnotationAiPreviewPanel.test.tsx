import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import { toBgColor } from '@/features/views/common/vizPalette';
import type { AnnotationAiPreview } from '../../hooks/useAnnotationAiPreview';
import { AnnotationAiPreviewPanel } from '../AnnotationAiPreviewPanel';

const mocks = vi.hoisted(() => ({
  setCell: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
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
    sourceColumns: ['text', 'annotation', 'correction', 'review', 'tweet_id'],
    sourceStringColumns: ['text', 'annotation', 'correction', 'review'],
    sourceComparableColumns: ['text', 'annotation', 'correction', 'review'],
    page: {
      rows: isLoading
        ? []
        : (rows ?? [
            {
              text: 'First text',
              annotation: 'existing',
              correction: 'replacement',
              review: 'replacement',
            },
            {
              text: 'Second text',
              annotation: null,
              correction: null,
              review: 'previous correction',
            },
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

const correction = (column: string | null = null) => ({
  nodeId: 'node-1',
  column,
  classOptions: ['replacement', 'new value', 'previous correction'],
  onCreate: vi.fn(),
  onUseAsExample: vi.fn(),
});

function PreviewPanel({
  preview: previewValue,
  correction: correctionValue,
}: {
  preview: AnnotationAiPreview;
  correction: ReturnType<typeof correction>;
}) {
  const [comparisonColumns, setComparisonColumns] = useState<string[]>([]);
  const [metric, setMetric] = useState<IntercoderReliabilityMetric>('cohens_kappa');
  const [metadataColumns, setMetadataColumns] = useState<string[]>([]);
  const [correctionColumn, setCorrectionColumn] = useState(correctionValue.column);
  return (
    <AnnotationAiPreviewPanel
      preview={previewValue}
      sourceColor="#2563eb"
      comparison={{
        columns: comparisonColumns,
        onColumnsChange: setComparisonColumns,
        metric,
        onMetricChange: setMetric,
      }}
      metadata={{ columns: metadataColumns, onColumnsChange: setMetadataColumns }}
      tableHeight={null}
      onTableHeightChange={vi.fn()}
      correction={{
        ...correctionValue,
        column: correctionColumn,
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
    mocks.setCell.mockReset();
    mocks.setCell.mockResolvedValue(undefined);
  });

  it('uses the target column name and shows progress inside every pending cell', () => {
    render(
      <PreviewPanel
        preview={preview({ labels: [null, null], isFetching: true })}
        correction={correction()}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'annotation (preview)' })).toBeInTheDocument();
    expect(screen.queryByText('AI prediction')).not.toBeInTheDocument();
    expect(screen.queryByText('Annotating...')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status', { name: 'Predicting annotation' })).toHaveLength(2);
  });

  it('keeps the table framework mounted while the requested page is processing', () => {
    render(
      <PreviewPanel
        preview={preview({ labels: [], isFetching: true, isLoading: true })}
        correction={correction()}
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
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction()}
      />,
    );

    expect(screen.getByTestId('analysis-table-scroll-area')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('rowgroup')[0]).toHaveClass(
      'sticky',
      'top-0',
      'z-10',
      'bg-surface',
    );
  });

  it('compares preview predictions with selected columns on the current page only', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compare To' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'review' }));
    await user.keyboard('{Escape}');

    expect(
      screen.getByRole('button', {
        name: 'Cohen’s Kappa 0.333 for annotation (preview) versus review',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText('Comparison value hidden')).toHaveLength(2);
    const maskedRow = screen.getByRole('row', {
      name: 'Second text new value Comparison value hidden',
    });
    expect(within(maskedRow).getAllByRole('cell')[1]).not.toHaveAttribute('style');
    expect(
      screen.getByRole('button', { name: 'Show comparison values for review' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show comparison values for review' }));

    expect(
      await screen.findByRole('button', {
        name: 'Cohen’s Kappa 0.333 for annotation (preview) versus review',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filter rows/ })).not.toBeInTheDocument();
    const secondRow = screen.getByRole('row', {
      name: 'Second text new value previous correction',
    });
    const cells = within(secondRow).getAllByRole('cell');
    expect(cells[1]).toHaveStyle({ backgroundColor: toBgColor('#2563eb') });
    expect(cells[2]).toHaveStyle({ backgroundColor: toBgColor('#2563eb') });
    expect(
      screen.queryByRole('heading', { name: 'annotation (preview) vs review' }),
    ).not.toBeInTheDocument();

    rerender(
      <PreviewPanel
        preview={preview({
          labels: ['new value'],
          isFetching: false,
          pageIndex: 1,
          rows: [{ text: 'Third text', annotation: null, review: 'replacement' }],
        })}
        correction={correction()}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Cohen’s Kappa 0.000 for annotation (preview) versus review',
      }),
    ).toBeInTheDocument();
  });

  it('offers only label columns and applies the selected reliability metric', async () => {
    const user = userEvent.setup();
    render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compare To' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'tweet_id' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitemradio', { name: 'Krippendorff’s Alpha' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'review' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show comparison values for review' }));

    expect(
      screen.getByRole('button', {
        name: 'Krippendorff’s Alpha 0.400 for annotation (preview) versus review',
      }),
    ).toHaveTextContent('α 0.400');
  });

  it('shows selected comparison columns read-only after the correction column', async () => {
    const user = userEvent.setup();
    render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction('correction')}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compare To' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'correction' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'review' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'correction' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show comparison values for review' }));

    const previewTable = screen.getAllByRole('table')[0];
    const headers = within(previewTable).getAllByRole('columnheader');
    expect(headers).toHaveLength(5);
    expect(headers.slice(0, 4).map((header) => header.textContent)).toEqual([
      'text',
      'annotation (preview)',
      '',
      'Correction: correction',
    ]);
    expect(within(headers[4]).getByText('review')).toBeInTheDocument();
    expect(within(headers[4]).getByRole('button', { name: /Cohen’s Kappa/ })).toBeInTheDocument();
    const firstRow = within(previewTable).getByRole('row', { name: /First text/ });
    expect(within(firstRow).getAllByRole('cell').at(-1)).toHaveTextContent('replacement');
    expect(within(firstRow).getAllByRole('combobox')).toHaveLength(1);
  });

  it('shows selected source metadata beside the preview columns', async () => {
    const user = userEvent.setup();
    render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'review' }));
    await user.keyboard('{Escape}');

    const previewTable = screen.getAllByRole('table')[0];
    expect(
      within(previewTable)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['text', 'annotation (preview)', 'review']);
    expect(within(previewTable).getByRole('row', { name: /First text/ })).toHaveTextContent(
      'replacement',
    );
  });

  it('shows an original annotation changing to its preview prediction', () => {
    render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction()}
      />,
    );

    expect(screen.getByText('existing')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'changes to' })).toBeInTheDocument();
    expect(screen.getByText('replacement')).toBeInTheDocument();
    expect(screen.getByText('new value')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Predicting annotation' })).not.toBeInTheDocument();
  });

  it('always shows a persisted correction even when it equals the preview prediction', () => {
    render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction('review')}
      />,
    );

    const firstRow = screen.getByRole('row', { name: /First text/ });
    expect(within(firstRow).getByRole('img', { name: 'corrected to' })).toBeInTheDocument();
    expect(within(firstRow).getAllByText('replacement')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'annotation (preview)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Correction: review' })).toBeInTheDocument();
  });

  it('always shows the selected correction and removes it only by selecting None', async () => {
    const user = userEvent.setup();
    render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction('review')}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Correction: review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use as example' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Correction column' }));
    await user.click(screen.getByRole('option', { name: 'None' }));

    expect(
      screen.queryByRole('columnheader', { name: 'Correction: review' }),
    ).not.toBeInTheDocument();
  });

  it('refreshes only the visible preview page from the lower-right action', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn().mockResolvedValue(undefined);
    render(
      <PreviewPanel
        preview={preview({
          labels: ['replacement', 'new value'],
          isFetching: false,
          refetch,
        })}
        correction={correction()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Refresh page' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('writes a selected correction from its separate correction column', async () => {
    const user = userEvent.setup();
    render(
      <PreviewPanel
        preview={preview({ labels: ['replacement', 'new value'], isFetching: false })}
        correction={correction('review')}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Correct prediction for row 1' }));
    await user.click(screen.getByRole('option', { name: 'new value' }));

    await waitFor(() => {
      expect(mocks.setCell).toHaveBeenCalledWith('node-1', 'review', 0, 'new value');
    });
    const firstRow = screen.getByRole('row', { name: /First text/ });
    expect(within(firstRow).getByText('replacement')).toBeInTheDocument();
    expect(within(firstRow).getByText('new value')).toBeInTheDocument();
    expect(within(firstRow).getByRole('img', { name: 'corrected to' })).toBeInTheDocument();
  });
});
