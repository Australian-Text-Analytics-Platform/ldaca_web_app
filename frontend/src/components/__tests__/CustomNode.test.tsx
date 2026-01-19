import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import CustomNode from '../CustomNode';

const buildNode = () => ({
  node_id: 'node-1',
  name: 'Sample Node',
  shape: [10, 5] as [number, number],
  columns: [],
  preview: [],
  is_text_data: false,
  data_type: 'LazyFrame',
  document_column: null,
  column_schema: {},
});

describe('CustomNode copy action', () => {
  it('invokes onCopy when copy menu item clicked', async () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();

    render(
      <ReactFlowProvider>
        <CustomNode
          {...({
            id: 'node-1',
            data: {
              node: buildNode(),
              onDelete,
              onCopy,
            },
            selected: false,
            type: 'customNode',
            position: { x: 0, y: 0 },
          } as any)}
        />
      </ReactFlowProvider>
    );

    await userEvent.click(screen.getByLabelText(/node settings/i));
    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(onCopy).toHaveBeenCalledWith('node-1');
  });
});
