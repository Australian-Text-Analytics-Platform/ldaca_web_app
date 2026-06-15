import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TokensColumnMismatchNotice } from '../TokensColumnMismatchNotice';

describe('TokensColumnMismatchNotice', () => {
  it('reads persisted tokenizer model source columns from node.tokenizer_models', () => {
    render(
      <TokensColumnMismatchNotice
        nodes={[
          {
            id: 'node-1',
            tokenizer_models: { text: 'lindera:jieba' },
          },
        ]}
        selections={[{ nodeId: 'node-1', column: 'notes' }]}
      />,
    );

    expect(screen.getByText(/No tokenizer model for/)).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('stays hidden when the selected column has a persisted tokenizer model', () => {
    render(
      <TokensColumnMismatchNotice
        nodes={[
          {
            id: 'node-1',
            tokenizer_models: { text: 'lindera:jieba' },
          },
        ]}
        selections={[{ nodeId: 'node-1', column: 'text' }]}
      />,
    );

    expect(screen.queryByText(/No tokenizer model for/)).not.toBeInTheDocument();
  });
});
