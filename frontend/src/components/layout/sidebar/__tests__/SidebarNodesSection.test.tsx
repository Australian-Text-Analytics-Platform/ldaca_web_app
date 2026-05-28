import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SidebarNodesSection from '../SidebarNodesSection';

/** Minimal node fixture used to verify row activation and display-name behavior. */
const nodes = [
  {
    id: 'node-1',
    data: {
      nodeName: 'Corpus',
      shape: [12, 4] as [number, number],
    },
  },
];

describe('SidebarNodesSection', () => {
  it('uses a non-button row wrapper and supports click and keyboard toggling', async () => {
    const user = userEvent.setup();
    const onToggleNodeSelection = vi.fn();

    render(
      <SidebarNodesSection
        nodes={nodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={onToggleNodeSelection}
      />,
    );

    const row = screen.getByRole('button', { name: 'Select Corpus' });

    expect(row.tagName).toBe('DIV');

    await user.click(row);
    expect(onToggleNodeSelection).toHaveBeenCalledWith('node-1');

    row.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onToggleNodeSelection).toHaveBeenCalledTimes(3);
  });
});
