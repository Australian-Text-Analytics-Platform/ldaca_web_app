import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConcordanceDispersionCell } from '../ConcordanceDispersionCell';

describe('ConcordanceDispersionCell', () => {
  const hits = [
    {
      CONC_start_idx: 0,
      CONC_end_idx: 5,
      CONC_matched_text: 'alpha',
      __source_node: 'Corpus',
    },
    {
      CONC_start_idx: 11,
      CONC_end_idx: 16,
      CONC_matched_text: 'beta',
      __source_node: 'Corpus',
    },
  ];

  it('uses the full available width by default', () => {
    const { unmount } = render(<ConcordanceDispersionCell hits={hits} textLength={16} />);

    expect(screen.getByTestId('concordance-dispersion-bar')).toHaveStyle({ width: '100%' });

    unmount();
  });

  it('supports proportional bar widths', () => {
    const { unmount } = render(
      <ConcordanceDispersionCell hits={hits} textLength={16} barWidthPercent={50} />,
    );

    expect(screen.getByTestId('concordance-dispersion-bar')).toHaveStyle({ width: '50%' });

    unmount();
  });

  it('uses the source Data Block color for every match marker', () => {
    render(
      <ConcordanceDispersionCell
        hits={hits}
        textLength={16}
        sourceColorMap={{ corpus: '#123456' }}
        defaultPalette={['#abcdef']}
      />,
    );

    const markers = screen.getAllByTestId('concordance-match-marker');
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker).toHaveStyle({ backgroundColor: '#123456' });
    }
  });

  it('uses the current Data Block color when no combined-source palette is needed', () => {
    render(<ConcordanceDispersionCell hits={hits} textLength={16} sourceColor="#654321" />);

    for (const marker of screen.getAllByTestId('concordance-match-marker')) {
      expect(marker).toHaveStyle({ backgroundColor: '#654321' });
    }
  });
});
