import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AnalysisFeatureHeader } from '../AnalysisFeatureHeader';

/**
 * Renders the header with tooltip context for icon assertions.
 */
function renderHeader() {
  return render(
    <TooltipProvider>
      <AnalysisFeatureHeader
        title="Concordance Search"
        infoKey="concordance.overview"
        infoLabel="About Concordance Search"
        helpKey="analysis.concordance.parameters"
        helpLabel="Concordance parameters"
      />
    </TooltipProvider>,
  );
}

describe('AnalysisFeatureHeader', () => {
  it('renders the title and info/help icons', () => {
    renderHeader();
    expect(screen.getByText('Concordance Search')).toBeInTheDocument();
    expect(screen.getByLabelText(/about concordance search/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/concordance parameters/i)).toBeInTheDocument();
  });
});
