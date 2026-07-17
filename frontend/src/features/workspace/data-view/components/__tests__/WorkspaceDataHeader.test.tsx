import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import { WorkspaceDataHeader } from '../WorkspaceDataHeader';

describe('WorkspaceDataHeader', () => {
  it('shows the data-view help control', () => {
    render(
      <TooltipProvider>
        <WorkspaceDataHeader
          info={{
            nodeLabel: 'sample_data/ADO/qldelection2020_candidate_tweets_conc',
            tabPosition: 1,
            totalTabs: 1,
            isEmptyTable: false,
          }}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole('button', { name: 'Data Viewer' })).toBeInTheDocument();
  });

  it('keeps the selected node name in a leading-fade single-line wrapper', () => {
    const longName = 'reddit/reddit_comments_topic_sampled_fr_0_1_rs_42_topic_meanings';

    render(
      <TooltipProvider>
        <WorkspaceDataHeader
          info={{
            nodeLabel: longName,
            tabPosition: 1,
            totalTabs: 1,
            isEmptyTable: false,
          }}
          onRename={vi.fn()}
        />
      </TooltipProvider>,
    );

    const nodeName = screen.getByText(longName);
    expect(nodeName).toBeInTheDocument();
    expect(screen.getByTestId('workspace-data-node-label')).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('workspace-data-node-label-fade')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename node' })).toBeInTheDocument();
  });
});
