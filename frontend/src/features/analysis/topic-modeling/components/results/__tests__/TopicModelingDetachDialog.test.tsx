import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingDetachDialog } from '../TopicModelingDetachDialog';

describe('TopicModelingDetachDialog', () => {
  it('shows mandatory generated columns as checked disabled and leaves optional metadata unchecked', () => {
    render(
      <TopicModelingDetachDialog
        open
        onOpenChange={vi.fn() as React.Dispatch<React.SetStateAction<boolean>>}
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
  });
});