import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultAddToWorkspaceDialog } from '../ResultAddToWorkspaceDialog';

describe('ResultAddToWorkspaceDialog', () => {
  it('selects all or no optional columns independently in contract order', () => {
    const onSubmit = vi.fn();
    const source = (id: string, name: string) => ({
      node_id: id,
      node_name: name,
      document_column: 'text',
      metadata_columns: ['speaker'],
      analysis_columns: ['CONC_matched_text', 'CONC_extraction'],
      internal_columns: ['__wordflow_source_row_id'],
      record_count: 3,
      table: { table_id: `${id}-result`, rows_url: '/rows', schema_url: '/schema' },
    });
    render(
      <ResultAddToWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        title="Add Results"
        nameSuffix="concordance"
        sources={[source('node-1', 'First'), source('node-2', 'Second')]}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole('button', { name: /apply to all/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all for First' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select none for First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select none for First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all for Second' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workspace' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        source_node_id: 'node-1',
        selected_columns: ['text'],
        new_node_name: 'First_concordance',
      },
      {
        source_node_id: 'node-2',
        selected_columns: ['text', 'speaker', 'CONC_matched_text', 'CONC_extraction'],
        new_node_name: 'Second_concordance',
      },
    ]);
  });

  it('preserves a source selection while that source is excluded', () => {
    render(
      <ResultAddToWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        title="Add Documents"
        nameSuffix="concordance_documents"
        sources={[
          {
            node_id: 'node-1',
            node_name: 'First',
            document_column: 'text',
            metadata_columns: ['speaker'],
            analysis_columns: ['CONC_extraction'],
            internal_columns: [],
            record_count: 1,
            table: { table_id: 'result', rows_url: '/rows', schema_url: '/schema' },
          },
        ]}
        isSubmitting={false}
        mode="document"
        allowSourceSelection
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'speaker' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
    expect(screen.queryByRole('button', { name: 'Select all for First' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));

    expect(screen.getByRole('checkbox', { name: 'speaker' })).toBeChecked();
  });

  it('requires the document column, defaults metadata off, and analysis columns on', () => {
    const onSubmit = vi.fn();
    render(
      <ResultAddToWorkspaceDialog
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

  it('creates only checked document sources and locks extraction on', () => {
    const onSubmit = vi.fn();
    const source = (id: string, name: string) => ({
      node_id: id,
      node_name: name,
      document_column: 'text',
      metadata_columns: ['speaker'],
      analysis_columns: ['CONC_matched_text', 'CONC_extraction'],
      internal_columns: ['__wordflow_source_row_id'],
      record_count: 0,
      table: { table_id: `${id}-result`, rows_url: '/rows', schema_url: '/schema' },
    });
    render(
      <ResultAddToWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        title="Add Documents"
        nameSuffix="concordance_documents"
        sources={[source('node-1', 'First'), source('node-2', 'Second')]}
        isSubmitting={false}
        mode="document"
        allowSourceSelection
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getAllByRole('checkbox', { name: /CONC_extraction.*required/i })).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Second' }));
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'speaker' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workspace' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        source_node_id: 'node-1',
        selected_columns: ['text', 'CONC_extraction', 'speaker'],
        new_node_name: 'First_concordance_documents',
      },
    ]);
  });
});
