/* eslint-disable testing-library/no-container, testing-library/no-node-access -- Radix exposes the imperative viewport only as an internal DOM slot. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dictionary,
  Field,
  Float64,
  Int64,
  LargeList,
  TimestampMicrosecond,
  Uint32,
  Utf8,
  Utf8View,
} from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

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

  it('shows canonical type labels once in the data type menu', async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceTable
        columns={['text', 'category', 'count', 'score', 'created_at']}
        columnFields={{
          text: new Field('text', new Utf8View()),
          category: new Field('category', new Dictionary(new Utf8View(), new Uint32())),
          count: new Field('count', new Int64()),
          score: new Field('score', new Float64()),
          created_at: new Field('created_at', new TimestampMicrosecond('UTC')),
        }}
        data={[
          {
            text: 'alpha',
            category: 'group-a',
            count: 1,
            score: 0.5,
            created_at: '2026-08-26T00:00:00.000Z',
          },
        ]}
        onCast={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Change data type for column text' }),
    ).toHaveTextContent('string');
    expect(
      screen.getByRole('button', { name: 'Change data type for column category' }),
    ).toHaveTextContent('categorical');
    expect(
      screen.getByRole('button', { name: 'Change data type for column count' }),
    ).toHaveTextContent('integer');
    expect(
      screen.getByRole('button', { name: 'Change data type for column score' }),
    ).toHaveTextContent('float');
    expect(
      screen.getByRole('button', { name: 'Change data type for column created_at' }),
    ).toHaveTextContent('datetime');

    await user.click(screen.getByRole('button', { name: 'Change data type for column category' }));

    expect(
      within(screen.getByRole('menu')).getAllByRole('menuitemradio', { name: 'categorical' }),
    ).toHaveLength(1);
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

  it('preserves both axes for sorting and resets only rows for pagination', () => {
    const onSortingChange = vi.fn();
    const onPageChange = vi.fn();
    const { container } = render(
      <WorkspaceTable
        workspaceId="workspace-1"
        nodeId="node-1"
        columns={['text']}
        columnFields={{ text: new Field('text', new Utf8()) }}
        data={[{ text: 'row' }]}
        pagination={{ page: 1, page_size: 20 }}
        rowCount={40}
        onSortingChange={onSortingChange}
        onPageChange={onPageChange}
      />,
    );
    const viewport = container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    viewport.scrollLeft = 180;
    viewport.scrollTop = 60;
    fireEvent.click(screen.getByRole('button', { name: 'Sort by text' }));

    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'text', desc: false }]);
    expect(viewport.scrollLeft).toBe(180);
    expect(viewport.scrollTop).toBe(60);

    fireEvent.click(screen.getByRole('link', { name: 'Go to next page' }));

    expect(onPageChange).toHaveBeenLastCalledWith(2);
    expect(viewport.scrollLeft).toBe(180);
    expect(viewport.scrollTop).toBe(0);
  });

  it('resets both axes when the owning Data Block changes', async () => {
    const props = {
      workspaceId: 'workspace-1',
      columns: ['text'],
      columnFields: { text: new Field('text', new Utf8()) },
      data: [{ text: 'row' }],
    };
    const { container, rerender } = render(<WorkspaceTable {...props} nodeId="node-1" />);
    const viewport = container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
    expect(viewport).not.toBeNull();
    if (!viewport) return;
    viewport.scrollLeft = 180;
    viewport.scrollTop = 60;

    rerender(<WorkspaceTable {...props} nodeId="node-2" />);

    await waitFor(() => {
      expect(viewport.scrollLeft).toBe(0);
      expect(viewport.scrollTop).toBe(0);
    });
  });
});
