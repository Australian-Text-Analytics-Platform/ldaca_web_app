import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultPublicationDialog } from '../ResultPublicationDialog';

describe('ResultPublicationDialog', () => {
  it('requires the document column, defaults metadata off, and analysis columns on', () => {
    const onSubmit = vi.fn();
    render(
      <ResultPublicationDialog
        open
        onOpenChange={vi.fn()}
        title="Add Results"
        nameSuffix="concordance"
        sources={[
          {
            node_id: 'node-1',
            node_name: 'Documents',
            document_column: 'text',
            metadata_columns: ['speaker'],
            analysis_columns: ['CONC_matched_text', 'CONC_extraction'],
            internal_columns: ['__wordflow_source_row_id'],
            record_count: 3,
            table: {
              table_id: 'result',
              rows_url: '/rows',
              schema_url: '/schema',
            },
          },
        ]}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    const document = screen.getByRole('checkbox', { name: /text.*required/i });
    const metadata = screen.getByRole('checkbox', { name: 'speaker' });
    const analysis = screen.getByRole('checkbox', { name: 'CONC_matched_text' });
    expect(document).toBeChecked();
    expect(document).toBeDisabled();
    expect(metadata).not.toBeChecked();
    expect(analysis).toBeChecked();
    expect(screen.getByLabelText('New Data Block name')).toHaveValue('Documents_concordance');

    fireEvent.click(screen.getByRole('button', { name: 'Add to Workspace' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        source_node_id: 'node-1',
        selected_columns: ['text', 'CONC_matched_text', 'CONC_extraction'],
        new_node_name: 'Documents_concordance',
      },
    ]);
  });
});
