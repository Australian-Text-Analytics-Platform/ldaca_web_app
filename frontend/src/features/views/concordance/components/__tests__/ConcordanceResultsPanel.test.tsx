import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { ConcordanceSourceSummaries } from '../ConcordanceResultsPanel';

const sources = [
  { id: 'corpus-a', name: 'Corpus A' },
  { id: 'corpus-b', name: 'Corpus B' },
] as WorkspaceNodeMetadata[];

const summaries = [
  { nodeId: 'corpus-a', matchCount: 1, documentCount: 1, sourceDocumentCount: 10 },
  { nodeId: 'corpus-b', matchCount: 24, documentCount: 8, sourceDocumentCount: 50 },
];

describe('ConcordanceSourceSummaries', () => {
  it('identifies combined-view summaries by source name and Data Block colour', () => {
    render(
      <ConcordanceSourceSummaries
        summaries={summaries}
        sources={sources}
        sourceColorMap={{ 'corpus-a': '#2563eb', 'corpus-b': '#dc2626' }}
        defaultPalette={[]}
        identifySources
      />,
    );

    expect(screen.getByLabelText('Concordance result summary for Corpus A')).toHaveTextContent(
      'Corpus A: Found 1 match in 1 document out of 10 documents.',
    );
    expect(screen.getByLabelText('Concordance result summary for Corpus A')).toHaveStyle({
      borderLeftWidth: '3px',
      borderLeftColor: '#2563eb',
    });
    expect(screen.getByLabelText('Concordance result summary for Corpus B')).toHaveTextContent(
      'Corpus B: Found 24 matches in 8 documents out of 50 documents.',
    );
    expect(screen.getByLabelText('Concordance result summary for Corpus B')).toHaveStyle({
      borderLeftWidth: '3px',
      borderLeftColor: '#dc2626',
    });
  });

  it('keeps the separated-view summary unchanged', () => {
    render(
      <ConcordanceSourceSummaries
        summaries={[summaries[0]!]}
        sources={sources}
        sourceColorMap={{ 'corpus-a': '#2563eb' }}
        defaultPalette={[]}
        identifySources={false}
      />,
    );

    const summary = screen.getByLabelText('Concordance result summary');
    expect(summary).toHaveTextContent('Found 1 match in 1 document out of 10 documents.');
    expect(summary).not.toHaveTextContent('Corpus A');
    expect(summary).not.toHaveStyle({ borderLeftWidth: '3px' });
  });
});
