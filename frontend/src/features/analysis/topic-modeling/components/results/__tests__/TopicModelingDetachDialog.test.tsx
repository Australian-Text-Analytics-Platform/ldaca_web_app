import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';

import { TopicModelingDetachDialog } from '../TopicModelingDetachDialog';

describe('TopicModelingDetachDialog', () => {
  it('shows mandatory generated columns as checked disabled and leaves optional metadata unchecked', () => {
    render(
      <TopicModelingDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['TOPIC_topic', 'document', 'speaker'],
            disabled_columns: ['TOPIC_topic'],
          },
        ]}
        selectedDetachColumns={{ 'node-1': [] }}
        toggleDetachColumn={vi.fn()}
        selectAllDetachColumns={vi.fn()}
        deselectAllDetachColumns={vi.fn()}
        handleDetachConfirm={vi.fn()}
      />
    );

    const topicCheckbox = screen.getByRole('checkbox', { name: /TOPIC_topic/i });
    const documentCheckbox = screen.getByRole('checkbox', { name: /document/i });
    const speakerCheckbox = screen.getByRole('checkbox', { name: /speaker/i });

    expect(topicCheckbox).toBeChecked();
    expect(topicCheckbox).toBeDisabled();
    expect(documentCheckbox).not.toBeChecked();
    expect(speakerCheckbox).not.toBeChecked();
    expect(screen.getByRole('button', { name: /^add to workspace$/i })).toBeInTheDocument();
  });

  it('renders a select all button and triggers the callback', async () => {
    const user = userEvent.setup();
    const selectAllDetachColumns = vi.fn();

    render(
      <TopicModelingDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['TOPIC_topic', 'document'],
            disabled_columns: ['TOPIC_topic'],
          },
        ]}
        selectedDetachColumns={{ 'node-1': [] }}
        toggleDetachColumn={vi.fn()}
        selectAllDetachColumns={selectAllDetachColumns}
        deselectAllDetachColumns={vi.fn()}
        handleDetachConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^select all$/i }));
    expect(selectAllDetachColumns).toHaveBeenCalledTimes(1);
  });

  it('renders a deselect all button and triggers the callback when optional columns are selected', async () => {
    const user = userEvent.setup();
    const deselectAllDetachColumns = vi.fn();

    render(
      <TopicModelingDetachDialog
        open
        onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
        isDetaching={false}
        detachNodeOptions={[
          {
            node_id: 'node-1',
            node_name: 'Node 1',
            available_columns: ['TOPIC_topic', 'document'],
            disabled_columns: ['TOPIC_topic'],
          },
        ]}
        selectedDetachColumns={{ 'node-1': ['document'] }}
        toggleDetachColumn={vi.fn()}
        selectAllDetachColumns={vi.fn()}
        deselectAllDetachColumns={deselectAllDetachColumns}
        handleDetachConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^deselect all$/i }));
    expect(deselectAllDetachColumns).toHaveBeenCalledTimes(1);
  });
});
