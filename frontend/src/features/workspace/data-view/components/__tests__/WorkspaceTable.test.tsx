import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkspaceTable } from '../WorkspaceTable';

describe('WorkspaceTable', () => {
  it('shows the document column in the detail panel and excludes it from metadata', async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceTable
        columns={['document', 'speaker', 'year']}
        columnKinds={{ document: 'string', speaker: 'string', year: 'integer' }}
        data={[
          {
            document: 'This is the full document body.',
            speaker: 'Ada',
            year: 2024,
          },
        ]}
        documentColumn="document"
      />,
    );

    await user.click(screen.getByText('This is the full document body.'));

    const dialog = await screen.findByRole('dialog');
    const detailPanel = within(dialog);

    expect(detailPanel.getByText('Row Details')).toBeInTheDocument();
    expect(detailPanel.getByText('Document: document')).toBeInTheDocument();
    expect(detailPanel.getByText('This is the full document body.')).toBeInTheDocument();

    const metadata = within(detailPanel.getByRole('table'));

    expect(metadata.getByText('speaker')).toBeInTheDocument();
    expect(metadata.getByText('Ada')).toBeInTheDocument();
    expect(metadata.queryByText(/^document$/)).not.toBeInTheDocument();
  });
});
