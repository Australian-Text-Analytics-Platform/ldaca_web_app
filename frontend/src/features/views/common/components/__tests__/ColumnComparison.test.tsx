import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  applyReferenceComparisonEdit,
  calculateCohensKappa,
  type ConfusionCount,
} from '@/features/views/common/columnComparisonModel';
import { ConfusionMatrix } from '../ColumnComparison';

const rows: ConfusionCount[] = [
  { reference: 'covid', comparison: 'covid', count: 3 },
  { reference: 'covid', comparison: 'job', count: 1 },
  { reference: 'job', comparison: 'covid', count: 1 },
  { reference: 'job', comparison: 'job', count: 3 },
];

describe('ColumnComparison', () => {
  it('calculates chance-corrected intercoder agreement from matrix counts', () => {
    expect(calculateCohensKappa(rows)).toBe(0.5);
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

  it('labels Cohen’s Kappa as intercoder reliability and keeps the legend below its grid', () => {
    render(
      <ConfusionMatrix
        referenceColumn="annotation"
        comparisonColumn="review"
        rows={rows}
        isLoading={false}
        isError={false}
      />,
    );

    const matrix = screen.getByLabelText('Confusion matrix');
    const reliability = screen.getByLabelText('Intercoder reliability');

    expect(within(matrix).getByRole('table')).toBeInTheDocument();
    expect(within(matrix).getByLabelText('Confusion matrix count scale')).toHaveTextContent(
      'Lower countHigher count',
    );
    expect(
      within(reliability).getByRole('heading', { name: 'Intercoder reliability' }),
    ).toBeVisible();
    expect(reliability).toHaveTextContent('Cohen’s Kappa');
    expect(reliability).toHaveTextContent('0.500');
  });

  it('tilts column labels while keeping every matrix column at a fixed width', () => {
    render(
      <ConfusionMatrix
        referenceColumn="annotation"
        comparisonColumn="review"
        rows={rows}
        isLoading={false}
        isError={false}
      />,
    );

    const matrix = screen.getByLabelText('Confusion matrix');
    const columnHeader = within(matrix).getByRole('columnheader', {
      name: 'covid comparison column',
    });
    const tiltedLabel = within(matrix).getByText('covid', {
      selector: 'thead span.-rotate-45',
    });

    expect(columnHeader).toHaveClass('w-6', 'min-w-6');
    expect(tiltedLabel).toHaveClass('-rotate-45', 'whitespace-nowrap');
  });
});
