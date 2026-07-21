import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingDetachDialog } from '../TopicModelingDetachDialog';
import { createDefaultTopicModelingDetachColumns } from '../topicModelingDetachState';

describe('TopicModelingDetachDialog', () => {
  it('uses a wide desktop layout for multi-source detachment', () => {
    const props: ComponentProps<typeof TopicModelingDetachDialog> = {
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

    render(<TopicModelingDetachDialog {...props} />);

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
    const selectedColumns = createDefaultTopicModelingDetachColumns(sources);

    render(
      <TopicModelingDetachDialog
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
