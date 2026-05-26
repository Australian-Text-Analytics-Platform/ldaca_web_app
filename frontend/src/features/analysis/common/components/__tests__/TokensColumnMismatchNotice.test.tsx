import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TokensColumnMismatchNotice from '../TokensColumnMismatchNotice';

describe('TokensColumnMismatchNotice', () => {
  it('reads tokenized source columns from node.tokenization', () => {
    render(
      <TokensColumnMismatchNotice
        nodes={[
          {
            id: 'node-1',
            tokenization: {
              text: {
                source_column: 'text',
                column_name: 'tokenization.text.jieba',
                model: 'jieba',
                language: 'zh',
                generated_at: '2026-05-12T00:00:00+00:00',
              },
            },
          },
        ]}
        selections={[{ nodeId: 'node-1', column: 'notes' }]}
      />,
    );

    expect(screen.getByText(/No tokens for/)).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('stays hidden when the selected column is tokenized', () => {
    render(
      <TokensColumnMismatchNotice
        nodes={[
          {
            id: 'node-1',
            tokenization: {
              text: {
                source_column: 'text',
                column_name: 'tokenization.text.jieba',
                model: 'jieba',
                language: 'zh',
                generated_at: '2026-05-12T00:00:00+00:00',
              },
            },
          },
        ]}
        selections={[{ nodeId: 'node-1', column: 'text' }]}
      />,
    );

    expect(screen.queryByText(/No tokens for/)).not.toBeInTheDocument();
  });
});