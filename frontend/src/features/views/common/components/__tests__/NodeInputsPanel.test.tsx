import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NodeInputsPanel } from '../NodeInputsPanel';

const resolvedNodes = [
  {
    id: 'node-1',
    name: 'Corpus A',
    node: { id: 'node-1', name: 'Corpus A', shape: [100, 2] },
    column: 'body',
    columnOptions: [{ name: 'body', dataType: 'string' }],
  },
];

const baseProps = {
  resolvedNodes,
  availableNodes: [],
  canAddMore: true,
  onAddNodes: vi.fn(() => []),
  getAddRejection: vi.fn(() => null),
  onRemoveNode: vi.fn(),
  onClear: vi.fn(),
  onColumnChange: vi.fn(),
};

describe('NodeInputsPanel', () => {
  it('lets auto-width column add-ons give remaining row space to the column selector', () => {
    render(
      <NodeInputsPanel
        {...baseProps}
        columnAddonWidth="auto"
        nodeColors={{ 'node-1': '#2563eb' }}
        onNodeColorChange={vi.fn()}
        renderColumnAddon={() => <div data-testid="column-addon">Sampling</div>}
      />,
    );

    expect(screen.getByTestId('column-addon')).toBeInTheDocument();
    expect(screen.getByTestId('node-inputs-column-addon')).toHaveClass('w-max');
    expect(screen.getByTestId('node-inputs-controls')).toHaveClass(
      'md:grid-cols-[minmax(0,1fr)_auto_auto]',
    );
  });
});
