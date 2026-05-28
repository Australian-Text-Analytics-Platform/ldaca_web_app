import type { Dispatch, SetStateAction } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingDetachDialog } from '../TopicModelingDetachDialog';

describe('TopicModelingDetachDialog', () => {
  it('disables Add to Workspace when no optional column is selected', () => {
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
      />,
    );

    expect(screen.getByRole('button', { name: /^add to workspace$/i })).toBeDisabled();
  });

  it('enables Add to Workspace once at least one column is selected per node', () => {
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
        selectedDetachColumns={{ 'node-1': ['document'] }}
        toggleDetachColumn={vi.fn()}
        selectAllDetachColumns={vi.fn()}
        deselectAllDetachColumns={vi.fn()}
        handleDetachConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^add to workspace$/i })).toBeEnabled();
  });
});
