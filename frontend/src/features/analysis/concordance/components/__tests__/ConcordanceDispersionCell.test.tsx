import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConcordanceDispersionCell } from '../ConcordanceDispersionCell';

describe('ConcordanceDispersionCell', () => {
  const hits = [
    {
      CONC_start_idx: 0,
      CONC_end_idx: 5,
    },
    {
      CONC_start_idx: 11,
      CONC_end_idx: 16,
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
});
