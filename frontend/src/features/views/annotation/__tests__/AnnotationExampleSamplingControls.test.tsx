import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnotationExampleSamplingControls } from '../components/AnnotationExampleSamplingControls';
import type { AnnotationExampleSamplingMethod } from '../hooks/useAnnotationTabSettings';

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [maximum, setMaximum] = useState(10);
  const [method, setMethod] = useState<AnnotationExampleSamplingMethod>('random');
  const [seed, setSeed] = useState(0);
  return (
    <AnnotationExampleSamplingControls
      maxExamplesPerClass={maximum}
      onMaxExamplesPerClassCommit={setMaximum}
      samplingMethod={method}
      onSamplingMethodChange={setMethod}
      randomSeed={seed}
      onRandomSeedCommit={setSeed}
      disabled={disabled}
    />
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('AnnotationExampleSamplingControls', () => {
  it('renders ordered defaults and shows the seed only for random sampling', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const maximum = screen.getByLabelText('Max examples per class');
    const method = screen.getByLabelText('Sampling method');
    const seed = screen.getByLabelText('Random seed');
    expect(maximum).toHaveValue(10);
    expect(method).toHaveTextContent('Random');
    expect(seed).toHaveValue(0);
    expect(maximum.compareDocumentPosition(method) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(method.compareDocumentPosition(seed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(method);
    await user.click(screen.getByRole('option', { name: 'First N' }));
    expect(screen.queryByLabelText('Random seed')).not.toBeInTheDocument();
  });

  it('normalizes integer inputs and disables every visible control', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    const maximum = screen.getByLabelText('Max examples per class');
    await user.clear(maximum);
    await user.type(maximum, '-3.8');
    await user.tab();
    expect(screen.getByLabelText('Max examples per class')).toHaveValue(1);

    const seed = screen.getByLabelText('Random seed');
    await user.clear(seed);
    await user.type(seed, '-2.4');
    await user.tab();
    expect(screen.getByLabelText('Random seed')).toHaveValue(0);

    unmount();
    render(<Harness disabled />);
    expect(screen.getByLabelText('Max examples per class')).toBeDisabled();
    expect(screen.getByLabelText('Sampling method')).toBeDisabled();
    expect(screen.getByLabelText('Random seed')).toBeDisabled();
  });
});
