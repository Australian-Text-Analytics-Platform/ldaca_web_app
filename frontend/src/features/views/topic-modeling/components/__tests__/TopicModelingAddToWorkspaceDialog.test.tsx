import { fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingAddToWorkspaceDialog } from '../TopicModelingAddToWorkspaceDialog';

describe('TopicModelingAddToWorkspaceDialog', () => {
  it('uses the shared synchronization behavior for multi-source columns', () => {
    const onSubmit = vi.fn();
    render(
      <TopicModelingAddToWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        sources={[
          {
            id: 'node-1',
            name: 'First',
            columns: ['id', 'text', 'speaker', 'first_only'],
            documentColumn: 'text',
          },
          {
            id: 'node-2',
            name: 'Second',
            columns: ['id', 'body', 'speaker', 'second_only'],
            documentColumn: 'body',
          },
        ]}
        selectedTopicCount={null}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    const sync = screen.getByRole('switch', { name: 'Sync columns' });
    expect(sync).not.toBeChecked();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'speaker' })[0]!);
    fireEvent.click(sync);

    expect(screen.getByRole('checkbox', { name: 'text' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'text' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'body' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'body' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'first_only' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'second_only' })).toBeDisabled();
    expect(
      screen
        .getAllByRole('checkbox', { name: 'speaker' })
        .every((checkbox) => checkbox.dataset.state === 'checked'),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Select all for First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workspace' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        sourceId: 'node-1',
        selectedColumns: ['id', 'speaker'],
        newName: 'First topics',
      },
      {
        sourceId: 'node-2',
        selectedColumns: ['id', 'speaker'],
        newName: 'Second topics',
      },
    ]);
  });

  it('uses the shared wide responsive layout', () => {
    const props: ComponentProps<typeof TopicModelingAddToWorkspaceDialog> = {
      open: true,
      onOpenChange: vi.fn(),
      sources: [],
      selectedTopicCount: null,
      isSubmitting: false,
      onSubmit: vi.fn(),
    };

    render(<TopicModelingAddToWorkspaceDialog {...props} />);

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-[calc(100vw-2rem)]', 'lg:max-w-5xl');
  });

  it('keeps TOPIC_top1 display-only and defaults only the document column', () => {
    const onSubmit = vi.fn();
    render(
      <TopicModelingAddToWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        sources={[
          {
            id: 'node-1',
            name: 'Corpus',
            columns: ['id', 'text', 'speaker'],
            documentColumn: 'text',
          },
        ]}
        selectedTopicCount={2}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText(/2 selected topics will be included/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'TOPIC_top1 (required)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'TOPIC_top1 (required)' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'text' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'id' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'speaker' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Workspace' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        sourceId: 'node-1',
        selectedColumns: ['text'],
        newName: 'Corpus topics',
      },
    ]);
  });
});
