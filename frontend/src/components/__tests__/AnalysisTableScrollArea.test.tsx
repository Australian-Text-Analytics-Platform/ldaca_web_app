import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnalysisTableScrollArea } from '../AnalysisTableScrollArea';

describe('AnalysisTableScrollArea', () => {
  it('uses a max-height container so table height shrinks to content until the cap is reached', () => {
    render(
      <AnalysisTableScrollArea maxHeightClass="max-h-100">
        <table>
          <tbody>
            <tr>
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </AnalysisTableScrollArea>,
    );

    const root = screen.getByTestId('analysis-table-scroll-area');
    expect(root).toHaveClass('max-h-100');
    expect(root).not.toHaveClass('h-100');
  });
});
