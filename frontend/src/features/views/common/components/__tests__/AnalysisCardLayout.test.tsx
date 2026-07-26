import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnalysisCardLayout } from '../AnalysisCardLayout';

describe('AnalysisCardLayout', () => {
  it('shows a Stop action for running analyses while preserving Clear Results', () => {
    render(
      <AnalysisCardLayout
        title="Example Analysis"
        actions={{
          onRunAll: vi.fn(),
          onStop: vi.fn(),
          onClear: vi.fn(),
          isRunningAll: true,
          hasResult: true,
        }}
      >
        <div>Parameters</div>
      </AnalysisCardLayout>,
    );

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear results/i })).toBeInTheDocument();
  });

  it('hides Stop when the analysis is not running', () => {
    render(
      <AnalysisCardLayout
        title="Example Analysis"
        actions={{
          onRunAll: vi.fn(),
          onStop: vi.fn(),
          onClear: vi.fn(),
          isRunningAll: false,
          hasResult: true,
        }}
      >
        <div>Parameters</div>
      </AnalysisCardLayout>,
    );

    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear results/i })).toBeInTheDocument();
  });

  it('omits Preview for analyses without a Preview contract', () => {
    render(
      <AnalysisCardLayout
        title="Full-table Analysis"
        actions={{
          onRunAll: vi.fn(),
          onClear: vi.fn(),
        }}
      >
        <div>Parameters</div>
      </AnalysisCardLayout>,
    );

    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run all/i })).toBeInTheDocument();
  });
});
