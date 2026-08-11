import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Int64, LargeList, Utf8, Utf8View } from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { WorkspaceTable } from '../WorkspaceTable';

describe('WorkspaceTable', () => {
  it('shows the native IPC type name instead of a frontend list alias', () => {
    render(
      <WorkspaceTable
        columns={['representative_words']}
        columnFields={{
          representative_words: new Field(
            'representative_words',
            new LargeList(new Field('item', new Utf8View())),
          ),
        }}
        data={[{ representative_words: ['alpha', 'beta'] }]}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Change data type for column representative_words' }),
    ).toHaveTextContent('LargeList<Utf8View>');
    expect(screen.queryByText('string-list')).not.toBeInTheDocument();
  });

  it('shows the document column in the detail panel and excludes it from metadata', async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceTable
        columns={['document', 'speaker', 'year']}
        columnFields={{
          document: new Field('document', new Utf8()),
          speaker: new Field('speaker', new Utf8()),
          year: new Field('year', new Int64()),
        }}
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
