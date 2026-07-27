import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('explains every disabled analysis action on hover', async () => {
    const user = userEvent.setup();
    render(
      <AnalysisCardLayout
        title="Example Analysis"
        actions={{
          onPreview: vi.fn(),
          onRunAll: vi.fn(),
          onStop: vi.fn(),
          onClear: vi.fn(),
          previewDisabled: true,
          runAllDisabled: true,
          stopDisabled: true,
          clearDisabled: true,
          isPreviewing: true,
        }}
      >
        <div>Parameters</div>
      </AnalysisCardLayout>,
    );

    const cases = [
      ['Preview', 'Preview is already running'],
      ['Run All', 'Wait for Preview to finish'],
      ['Clear Results', 'Stop the running analysis before clearing results'],
      ['Stop', 'This task cannot be stopped right now'],
    ] as const;

    for (const [buttonName, reason] of cases) {
      const button = screen.getByRole('button', { name: buttonName });
      await user.hover(button);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(reason);
      await user.unhover(button);
    }
  });

  it('explains a disabled analysis action on keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <AnalysisCardLayout
        title="Example Analysis"
        actions={{
          onRunAll: vi.fn(),
          onClear: vi.fn(),
          runAllDisabled: true,
          runAllDisabledReason: 'Choose a Data Block first',
        }}
      >
        <div>Parameters</div>
      </AnalysisCardLayout>,
    );

    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Choose a Data Block first');
  });
});
