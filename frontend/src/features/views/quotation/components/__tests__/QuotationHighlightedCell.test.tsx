import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QUOTATION_COLUMN_KEYS } from '../../../common/generatedColumns';
import { normalizeQuotationRow } from '../../quotationResultsModel';
import { renderQuotationDetailText } from '../quotationDetailText';
import { QuotationHighlightedCell } from '../QuotationHighlightedCell';

describe('Quotation highlighted render adapters', () => {
  const row = normalizeQuotationRow(
    {
      text: 'A😀BCD',
      [QUOTATION_COLUMN_KEYS.quote]: '😀B',
      [QUOTATION_COLUMN_KEYS.quoteStartIdx]: 1,
      [QUOTATION_COLUMN_KEYS.quoteEndIdx]: 3,
      [QUOTATION_COLUMN_KEYS.speakerStartIdx]: 2,
      [QUOTATION_COLUMN_KEYS.speakerEndIdx]: 4,
    },
    'text',
  );

  it('renders Unicode and overlapping canonical segments without reparsing the row', () => {
    const onHoverChange = vi.fn();
    render(
      <QuotationHighlightedCell
        row={row}
        cellKey="node:0:document"
        contextLength={10}
        hoverState={null}
        onHoverChange={onHoverChange}
      />,
    );

    expect(screen.getByText('😀')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getAllByText('QUOTE')).toHaveLength(2);
    expect(screen.getAllByText('SPEAKER')).toHaveLength(2);
    fireEvent.mouseEnter(screen.getByText('B'));
    expect(onHoverChange).toHaveBeenCalledWith({
      key: 'node:0:document',
      segmentStart: 3,
      type: 'quote',
    });
  });

  it('uses the same normalized row for the unclipped detail adapter', () => {
    render(<>{renderQuotationDetailText(row)}</>);

    expect(screen.getByText('😀')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getAllByText('QUOTE')).toHaveLength(2);
    expect(screen.getAllByText('SPEAKER')).toHaveLength(2);
  });
});
