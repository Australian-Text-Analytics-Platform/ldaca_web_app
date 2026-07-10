import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TokensColumnMismatchNotice } from '../TokensColumnMismatchNotice';

describe('TokensColumnMismatchNotice', () => {
  it('reads projected tokenizer model source columns from node metadata', () => {
    render(
      <TokensColumnMismatchNotice
        nodes={[
          {
            id: 'node-1',
            name: 'Corpus',
            color: null,
            document: null,
            columns: ['text'],
            schema: { text: 'String' },
            shape: undefined,
            tokenizerModels: { text: 'lindera:jieba' },
            canUndo: false,
            canRedo: false,
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
            name: 'Corpus',
            color: null,
            document: null,
            columns: ['text'],
            schema: { text: 'String' },
            shape: undefined,
            tokenizerModels: { text: 'lindera:jieba' },
            canUndo: false,
            canRedo: false,
          },
        ]}
        selections={[{ nodeId: 'node-1', column: 'text' }]}
      />,
    );

    expect(screen.queryByText(/No tokenizer model for/)).not.toBeInTheDocument();
  });
});
