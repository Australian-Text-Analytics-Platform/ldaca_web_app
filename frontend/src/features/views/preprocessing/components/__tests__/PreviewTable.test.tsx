import { render, screen, within } from '@testing-library/react';
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
});
