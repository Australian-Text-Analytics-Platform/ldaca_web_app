import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingAddToWorkspaceDialog } from '../TopicModelingAddToWorkspaceDialog';
import { createDefaultTopicModelingAddToWorkspaceColumns } from '../topicModelingAddToWorkspaceState';

describe('TopicModelingAddToWorkspaceDialog', () => {
  it('selects all or no source columns independently', () => {
    const sources = [
      { id: 'node-1', name: 'First', columns: ['id', 'text'], documentColumn: 'text' },
      { id: 'node-2', name: 'Second', columns: ['date', 'body'], documentColumn: 'body' },
    ];

    function Harness() {
      const [selectedColumns, setSelectedColumns] = useState(
        createDefaultTopicModelingAddToWorkspaceColumns(sources),
      );
      return (
        <TopicModelingAddToWorkspaceDialog
          open
          onOpenChange={vi.fn()}
          sources={sources}
          selectedSourceIds={new Set(['node-1', 'node-2'])}
          selectedColumns={selectedColumns}
          names={{ 'node-1': 'First topics', 'node-2': 'Second topics' }}
          selectedTopicCount={null}
          isSubmitting={false}
          onToggleSource={vi.fn()}
          onToggleColumn={(nodeId, column) => {
            setSelectedColumns((current) => {
              const selected = current[nodeId] ?? [];
              return {
                ...current,
                [nodeId]: selected.includes(column)
                  ? selected.filter((candidate) => candidate !== column)
                  : [...selected, column],
              };
            });
          }}
          onNameChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByRole('button', { name: /apply to all/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all for First' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Select none for Second' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all for First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select none for Second' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select none for Second' }));

    expect(screen.getByRole('checkbox', { name: 'id' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'text' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'date' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'body' })).not.toBeChecked();
  });

  it('uses a wide desktop layout for multi-source Add to Workspace', () => {
    const props: ComponentProps<typeof TopicModelingAddToWorkspaceDialog> = {
      open: true,
      onOpenChange: vi.fn(),
      sources: [],
      selectedSourceIds: new Set(),
      selectedColumns: {},
      names: {},
      selectedTopicCount: null,
      isSubmitting: false,
      onToggleSource: vi.fn(),
      onToggleColumn: vi.fn(),
      onNameChange: vi.fn(),
      onSubmit: vi.fn(),
    };

    render(<TopicModelingAddToWorkspaceDialog {...props} />);

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-[calc(100vw-2rem)]', 'lg:max-w-5xl');
  });

  it('requires the generated topic column and defaults only the document column', () => {
    const sources = [
      {
        id: 'node-1',
        name: 'Corpus',
        columns: ['id', 'text', 'speaker'],
        documentColumn: 'text',
      },
    ];
    const selectedColumns = createDefaultTopicModelingAddToWorkspaceColumns(sources);

    render(
      <TopicModelingAddToWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        sources={sources}
        selectedSourceIds={new Set(['node-1'])}
        selectedColumns={selectedColumns}
        names={{ 'node-1': 'Corpus topics' }}
        selectedTopicCount={null}
        isSubmitting={false}
        onToggleSource={vi.fn()}
        onToggleColumn={vi.fn()}
        onNameChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'TOPIC_top1 (required)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'TOPIC_top1 (required)' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'text' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'id' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'speaker' })).not.toBeChecked();
  });
});
