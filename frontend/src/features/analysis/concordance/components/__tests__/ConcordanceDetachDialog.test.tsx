import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConcordanceDetachDialog } from '../ConcordanceDetachDialog';

describe('ConcordanceDetachDialog', () => {
  it('shows generated concordance columns as mandatory and leaves optional metadata unchecked', () => {
    render(
      <ConcordanceDetachDialog
        open
        onOpenChange={vi.fn() as React.Dispatch<React.SetStateAction<boolean>>}
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
        handleDetachConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('checkbox', { name: /^text/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^text/i })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /CONC_left_context/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /CONC_matched_text/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /CONC_right_context/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /speaker/i })).not.toBeChecked();
  });
});