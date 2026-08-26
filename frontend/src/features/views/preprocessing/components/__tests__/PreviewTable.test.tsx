import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PreviewTable } from '../PreviewTable';

describe('PreviewTable', () => {
  it('opens row details and promotes the document column out of metadata', async () => {
    const user = userEvent.setup();

    render(
      <PreviewTable
        title="Preview"
        description="Inspect preview rows."
        columns={['document', 'speaker', 'year']}
        data={[
          {
            document: 'Preview document text.',
            speaker: 'Ada',
            year: 2024,
          },
        ]}
        pagination={null}
        loading={false}
        error={null}
        ready
        page={1}
        pageSize={10}
        documentColumn="document"
        onPageSizeChange={() => {
          /* no-op for test */
        }}
        onPageChange={() => {
          /* no-op for test */
        }}
      />,
    );

    await user.click(screen.getByText('Preview document text.'));

    const dialog = await screen.findByRole('dialog');
    const detailPanel = within(dialog);

    expect(detailPanel.getByText('Row Details')).toBeInTheDocument();
    expect(detailPanel.getByText('Document: document')).toBeInTheDocument();
    expect(detailPanel.getByText('Preview document text.')).toBeInTheDocument();

    const metadata = within(detailPanel.getByRole('table'));
    expect(metadata.getByText('speaker')).toBeInTheDocument();
    expect(metadata.getByText('Ada')).toBeInTheDocument();
    expect(metadata.queryByText(/^document$/)).not.toBeInTheDocument();
  });

  it('keeps row details open while moving to the next server page', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [page, setPage] = useState(1);
      return (
        <PreviewTable
          title="Preview"
          description="Inspect preview rows."
          columns={['document']}
          data={[{ document: page === 1 ? 'Page one row.' : 'Page two row.' }]}
          pagination={{ page, page_size: 1, has_next: page === 1 }}
          loading={false}
          error={null}
          ready
          page={page}
          pageSize={1}
          documentColumn="document"
          onPageSizeChange={() => {
            /* no-op for test */
          }}
          onPageChange={setPage}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByText('Page one row.'));
    await user.click(screen.getByRole('button', { name: 'Next row' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByText('Page two row.')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Page 2')).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: 'Previous row' })).toBeEnabled();
  });
});
