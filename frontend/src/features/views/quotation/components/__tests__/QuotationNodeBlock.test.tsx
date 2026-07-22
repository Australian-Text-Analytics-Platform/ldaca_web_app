import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../../../common/generatedColumns';
import { normalizeQuotationRow } from '../../quotationResultsModel';
import { QuotationNodeBlock } from '../QuotationNodeBlock';

describe('QuotationNodeBlock', () => {
  it('translates the virtual document sort and limits other sorting to source metadata', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    const row = normalizeQuotationRow(
      {
        text: 'Alice said hello.',
        speaker: 'Alice',
        [QUOTATION_COLUMN_KEYS.quote]: 'hello',
        [QUOTATION_COLUMN_KEYS.quoteStartIdx]: 11,
        [QUOTATION_COLUMN_KEYS.quoteEndIdx]: 16,
      },
      'text',
    );

    const nodeBlock = (textCol: string) => (
      <QuotationNodeBlock
        nodeId="node-1"
        textCol={textCol}
        cols={[QUOTATION_DOCUMENT_COLUMN, 'speaker', QUOTATION_COLUMN_KEYS.quote]}
        sortableColumns={['text', 'speaker']}
        rows={[row]}
        pagination={{
          page: 1,
          page_size: 20,
          total_source_rows: 1,
          total_source_pages: 1,
          result_count: 1,
          has_next: false,
          has_prev: false,
        }}
        sortBy="text"
        contextLength={10}
        hoverState={null}
        onHoverChange={vi.fn()}
        onSort={onSort}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onRowClick={vi.fn()}
        pageSizeOptions={[20]}
      />
    );
    const { rerender } = render(nodeBlock(''));

    expect(
      screen.queryByRole('button', { name: QUOTATION_DOCUMENT_COLUMN }),
    ).not.toBeInTheDocument();
    rerender(nodeBlock('text'));

    await user.click(screen.getByRole('button', { name: QUOTATION_DOCUMENT_COLUMN }));
    await user.click(screen.getByRole('button', { name: 'speaker' }));

    expect(onSort).toHaveBeenNthCalledWith(1, 'node-1', 'text');
    expect(onSort).toHaveBeenNthCalledWith(2, 'node-1', 'speaker');
    expect(
      screen.queryByRole('button', { name: QUOTATION_COLUMN_KEYS.quote }),
    ).not.toBeInTheDocument();
  });
});
