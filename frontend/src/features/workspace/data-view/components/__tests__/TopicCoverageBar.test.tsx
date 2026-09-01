import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TopicCoverageBar } from '../TopicCoverageBar';

describe('TopicCoverageBar', () => {
  it('renders decoded Arrow entries as ordered source coverage', () => {
    render(
      <TopicCoverageBar
        value={[
          { topic_id: '-1', coverage: 0.1 },
          { topic_id: '0', coverage: 0.6 },
          { topic_id: '1', coverage: 0.3 },
        ]}
      />,
    );

    const bar = screen.getByRole('img');
    expect(bar).toHaveAttribute('aria-label', 'Topic 0: 60.0%, Topic 1: 30.0%, Topic -1: 10.0%');
    expect(screen.getByText('T0 60%')).toBeInTheDocument();
    expect(screen.getByText('T1 30%')).toBeInTheDocument();
    expect(screen.getByText('outlier 10%')).toBeInTheDocument();
    const leadingSegment = screen.getByTitle('Topic 0: 60.0%');
    expect(Number.parseFloat(leadingSegment.style.width)).toBeCloseTo(60);
    expect(leadingSegment.style.backgroundColor).not.toBe('');
  });
});
