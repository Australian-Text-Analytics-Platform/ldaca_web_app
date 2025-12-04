import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import AnalysisTaskBanner from '../AnalysisTaskBanner';

describe('AnalysisTaskBanner', () => {
  it('renders trimmed message and children content', () => {
    render(
      <AnalysisTaskBanner analysisName="Concordance" message="   Running task now   ">
        <span data-testid="banner-child">Details go here</span>
      </AnalysisTaskBanner>
    );

    expect(screen.getByText('Running task now')).toBeInTheDocument();
    expect(screen.getByTestId('banner-child')).toBeInTheDocument();

    const region = screen.getByLabelText('Concordance task running');
    expect(region).toBeInTheDocument();
    expect(region).toHaveClass('text-amber-900');

    const spinnerWrapper = screen.getByTestId('analysis-task-spinner');
    expect(spinnerWrapper).toBeInTheDocument();
    const spinnerIcon = within(spinnerWrapper).getByTestId('analysis-task-spinner-icon');
    expect(spinnerIcon).toHaveClass('animate-spin');
  });

  it('applies queued styles and includes the task id in the aria label', () => {
    render(
      <AnalysisTaskBanner
        analysisName="Topic Modeling"
        status="queued"
        taskId="task-123"
        message="  Job waiting in queue  "
        className="extra-class"
      />
    );

    const region = screen.getByLabelText('Topic Modeling task queued (task task-123)');
    expect(region).toHaveClass('text-sky-900');

    const card = screen.getByTestId('analysis-task-card');
    expect(card).toHaveClass('bg-sky-50/80');
    expect(card).toHaveClass('border-sky-200');
    expect(card).toHaveClass('extra-class');
  });
});
