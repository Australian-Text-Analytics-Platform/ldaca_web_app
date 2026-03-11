import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { QuotationDetachDialog } from '../QuotationDetachDialog';

describe('QuotationDetachDialog', () => {
  it('shows generated quotation columns as mandatory and leaves optional metadata unchecked', () => {
    render(
      <QuotationDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['text', 'QUOTE_quote', 'QUOTE_speaker', 'speaker_role'],
            disabled_columns: ['QUOTE_quote', 'QUOTE_speaker'],
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
    expect(screen.getByRole('checkbox', { name: /QUOTE_quote/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /QUOTE_quote/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /QUOTE_speaker/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /speaker_role/i })).not.toBeChecked();
  });

  it('renders a select all button and triggers the callback', async () => {
    const user = userEvent.setup();
    const selectAllDetachColumns = vi.fn();

    render(
      <QuotationDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['text', 'speaker_role'],
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
      <QuotationDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['text', 'speaker_role'],
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
