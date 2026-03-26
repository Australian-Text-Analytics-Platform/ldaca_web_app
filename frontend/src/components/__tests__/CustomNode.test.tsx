import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CustomNode from '../CustomNode';

vi.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right' },
  useStore: (selector: (state: { transform: [number, number, number] }) => number) => selector({ transform: [0, 0, 1] }),
}));

describe('CustomNode', () => {
  it('marks the rename input as non-draggable so React Flow does not intercept clicks', async () => {
    const user = userEvent.setup();

    render(
      <CustomNode
        {
          ...({
            data: {
              node: {
                node_id: 'node-1',
                name: 'sample_data/ADO/qldelection2020_samidata_tweets',
                shape: [2380, 15],
                columns: [],
                preview: [],
                is_text_data: false,
              },
              onDelete: vi.fn(),
              onRename: vi.fn(),
            },
            selected: false,
          } as React.ComponentProps<typeof CustomNode>)
        }
      />
    );

    await user.click(screen.getByRole('button', { name: /node settings/i }));
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    const renameInput = screen.getByDisplayValue('sample_data/ADO/qldelection2020_samidata_tweets');

    await waitFor(() => expect(renameInput).toHaveFocus());
    expect(renameInput).toHaveClass('nodrag');
    expect(renameInput).toHaveClass('nopan');
  });
});