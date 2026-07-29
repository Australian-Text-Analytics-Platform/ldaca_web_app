import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  applyReferenceComparisonEdit,
  type ConfusionCount,
  calculateCohensKappa,
  calculateKrippendorffsAlpha,
  calculatePercentAgreement,
} from '@/features/views/common/columnComparisonModel';
import { ColumnComparisonHeader, ColumnComparisonSelector } from '../ColumnComparison';

const rows: ConfusionCount[] = [
  { reference: 'covid', comparison: 'covid', count: 3 },
  { reference: 'covid', comparison: 'job', count: 1 },
  { reference: 'job', comparison: 'covid', count: 1 },
  { reference: 'job', comparison: 'job', count: 3 },
];

describe('ColumnComparison', () => {
  it('calculates chance-corrected intercoder agreement from matrix counts', () => {
    expect(calculatePercentAgreement(rows)).toBe(0.75);
    expect(calculateCohensKappa(rows)).toBe(0.5);
    expect(calculateKrippendorffsAlpha(rows)).toBe(0.53125);
    expect(
      calculateCohensKappa([
        { reference: 'covid', comparison: 'covid', count: 2 },
        { reference: 'job', comparison: 'job', count: 2 },
      ]),
    ).toBe(1);
    expect(
      calculateCohensKappa([{ reference: 'covid', comparison: 'covid', count: 4 }]),
    ).toBeNull();
  });

  it('updates aggregate pairs for one persisted reference edit', () => {
    expect(
      applyReferenceComparisonEdit(rows, {
        previousReference: 'covid',
        nextReference: 'job',
        comparison: 'covid',
      }),
    ).toEqual([
      { reference: 'covid', comparison: 'covid', count: 2 },
      { reference: 'covid', comparison: 'job', count: 1 },
      { reference: 'job', comparison: 'covid', count: 2 },
      { reference: 'job', comparison: 'job', count: 3 },
    ]);
    expect(
      applyReferenceComparisonEdit([{ reference: '', comparison: 'covid', count: 1 }], {
        previousReference: '',
        nextReference: null,
        comparison: 'covid',
      }),
    ).toEqual([]);
    expect(
      applyReferenceComparisonEdit(rows, {
        previousReference: 'covid',
        nextReference: 'job',
        comparison: null,
      }),
    ).toBe(rows);
  });

  it('shows Cohen’s Kappa beside the column and plain matrix counts on hover', async () => {
    const user = userEvent.setup();
    render(
      <ColumnComparisonHeader
        label="review"
        metric="cohens_kappa"
        referenceColumn="annotation"
        comparisonColumn="review"
        rows={rows}
        isLoading={false}
        isError={false}
      />,
    );

    const score = screen.getByRole('button', {
      name: 'Cohen’s Kappa 0.500 for annotation versus review',
    });
    expect(screen.getByText('review')).toBeVisible();
    expect(score).toBeVisible();
    expect(score).toHaveClass('h-7', 'px-2.5', 'text-sm');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.hover(score);

    const [matrix] = await screen.findAllByRole('table', {
      name: 'annotation versus review confusion matrix',
    });
    expect(matrix).toBeDefined();
    if (!matrix) throw new Error('Expected a confusion matrix in the reliability tooltip.');
    const [columnAxis] = screen.getAllByLabelText('review column axis');
    const [rowAxis] = screen.getAllByLabelText('annotation row axis');
    expect(columnAxis).toBeVisible();
    expect(columnAxis).toHaveTextContent('review');
    expect(rowAxis).toBeVisible();
    if (!rowAxis) throw new Error('Expected an annotation row axis.');
    expect(rowAxis).toHaveTextContent('annotation');
    expect(within(rowAxis).getByText('annotation')).toHaveClass(
      'rotate-180',
      '[writing-mode:vertical-rl]',
    );
    expect(screen.queryByText('annotation ↓ / review →')).not.toBeInTheDocument();
    const matrixRows = within(matrix).getAllByRole('row');

    expect(
      within(matrixRows[1])
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['3', '1']);
    expect(
      within(matrixRows[2])
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['1', '3']);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('formats the selected reliability metric with its conventional sign', () => {
    const { rerender } = render(
      <ColumnComparisonHeader
        metric="percent_agreement"
        referenceColumn="annotation"
        comparisonColumn="review"
        rows={rows}
        isLoading={false}
        isError={false}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Percent Agreement 75.0% for annotation versus review',
      }),
    ).toHaveTextContent('75.0%');

    rerender(
      <ColumnComparisonHeader
        metric="krippendorffs_alpha"
        referenceColumn="annotation"
        comparisonColumn="review"
        rows={rows}
        isLoading={false}
        isError={false}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Krippendorff’s Alpha 0.531 for annotation versus review',
      }),
    ).toHaveTextContent('α 0.531');
  });

  it('exposes the accessible difference-filter toggle when the table enables it', async () => {
    const user = userEvent.setup();
    const onDifferenceFilterChange = vi.fn();
    const { rerender } = render(
      <ColumnComparisonHeader
        metric="cohens_kappa"
        referenceColumn="annotation"
        comparisonColumn="review"
        rows={rows}
        isLoading={false}
        isError={false}
        differenceFilterActive={false}
        onDifferenceFilterChange={onDifferenceFilterChange}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Filter difference for review' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.textContent).toBe('');
    await user.hover(toggle);
    expect((await screen.findAllByText('Filter difference'))[0]).toBeVisible();
    await user.click(toggle);
    expect(onDifferenceFilterChange).toHaveBeenCalledWith(true);
    rerender(
      <ColumnComparisonHeader
        metric="cohens_kappa"
        referenceColumn="annotation"
        comparisonColumn="review"
        rows={rows}
        isLoading={false}
        isError={false}
        differenceFilterActive
        onDifferenceFilterChange={onDifferenceFilterChange}
      />,
    );
    const activeToggle = screen.getByRole('button', { name: 'Filter difference for review' });
    expect(activeToggle.textContent).toBe('');
  });

  it('offers all reliability metrics above the comparison checklist', async () => {
    const user = userEvent.setup();
    const onMetricChange = vi.fn();
    render(
      <ColumnComparisonSelector
        availableColumns={['review']}
        selectedColumns={[]}
        onSelectedColumnsChange={vi.fn()}
        metric="cohens_kappa"
        onMetricChange={onMetricChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compare To' }));

    const reliabilityOptions = screen.getAllByRole('menuitemradio');
    expect(reliabilityOptions.map((option) => option.textContent)).toEqual([
      'Percent Agreement',
      'Cohen’s Kappa',
      'Krippendorff’s Alpha',
    ]);
    expect(screen.getByRole('menuitemcheckbox', { name: 'review' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitemradio', { name: 'Krippendorff’s Alpha' }));
    expect(onMetricChange).toHaveBeenCalledWith('krippendorffs_alpha');
  });
});
