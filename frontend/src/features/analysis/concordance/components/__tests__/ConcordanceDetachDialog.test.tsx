import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';

import { ConcordanceDetachDialog } from '../ConcordanceDetachDialog';

describe('ConcordanceDetachDialog', () => {
  it('shows generated concordance columns as mandatory and leaves optional metadata unchecked', () => {
    render(
      <ConcordanceDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['text', 'CONC_left_context', 'CONC_matched_text', 'CONC_right_context', 'speaker'],
            disabled_columns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context'],
          },
        ]}
        selectedDetachColumns={{ 'node-1': [] }}
        toggleDetachColumn={vi.fn()}
        selectAllDetachColumns={vi.fn()}
        deselectAllDetachColumns={vi.fn()}
        handleDetachConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('checkbox', { name: /^text/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^text/i })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /CONC_left_context/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /CONC_matched_text/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /CONC_right_context/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /speaker/i })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /^add to workspace$/i })).toBeInTheDocument();
  });

  it('renders a select all button and triggers the callback', async () => {
    const user = userEvent.setup();
    const selectAllDetachColumns = vi.fn();

    render(
      <ConcordanceDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['text', 'speaker'],
            disabled_columns: [],
          },
        ]}
        selectedDetachColumns={{ 'node-1': [] }}
        toggleDetachColumn={vi.fn()}
        selectAllDetachColumns={selectAllDetachColumns}
        deselectAllDetachColumns={vi.fn()}
        handleDetachConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^select all$/i }));
    expect(selectAllDetachColumns).toHaveBeenCalledTimes(1);
  });

  it('renders a deselect all button and triggers the callback when optional columns are selected', async () => {
    const user = userEvent.setup();
    const deselectAllDetachColumns = vi.fn();

    render(
      <ConcordanceDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['text', 'speaker'],
            disabled_columns: [],
          },
        ]}
        selectedDetachColumns={{ 'node-1': ['text'] }}
        toggleDetachColumn={vi.fn()}
        selectAllDetachColumns={vi.fn()}
        deselectAllDetachColumns={deselectAllDetachColumns}
        handleDetachConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^deselect all$/i }));
    expect(deselectAllDetachColumns).toHaveBeenCalledTimes(1);
  });
});
