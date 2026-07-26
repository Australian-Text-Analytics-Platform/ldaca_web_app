import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnotationInferenceSettings } from '../components/AnnotationInferenceSettings';

// Stateful host so the reasoning switch + effort select actually update as the
// user interacts, exercising the "effort appears only when reasoning is on" flow
// and letting us assert the commit callbacks fire with the right values.
function Harness({
  initialTemperature = 0,
  initialReasoning = false,
  initialEffort = 'medium',
  disabled = false,
  onTemperatureCommit = vi.fn(),
}: {
  initialTemperature?: number;
  initialReasoning?: boolean;
  initialEffort?: string;
  disabled?: boolean;
  onTemperatureCommit?: (value: number) => void;
}) {
  const [temperature, setTemperature] = useState(initialTemperature);
  const [reasoningEnabled, setReasoningEnabled] = useState(initialReasoning);
  const [reasoningEffort, setReasoningEffort] = useState(initialEffort);
  return (
    <AnnotationInferenceSettings
      temperature={temperature}
      onTemperatureCommit={(value) => {
        setTemperature(value);
        onTemperatureCommit(value);
      }}
      reasoningEnabled={reasoningEnabled}
      onReasoningEnabledChange={setReasoningEnabled}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={setReasoningEffort}
      disabled={disabled}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select relies on pointer-capture + scrollIntoView, which jsdom lacks.
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('AnnotationInferenceSettings', () => {
  it('renders temperature and reasoning controls for the shared Advanced section', () => {
    render(<Harness initialTemperature={0.5} />);

    expect(screen.getByLabelText('Temperature')).toHaveValue(0.5);
    expect(screen.getByRole('switch', { name: 'Toggle reasoning' })).not.toBeChecked();
    expect(screen.queryByLabelText('Thinking effort')).not.toBeInTheDocument();
  });

  it('shows the thinking-effort select only after reasoning is enabled', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByLabelText('Thinking effort')).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Toggle reasoning' }));

    const effort = screen.getByLabelText('Thinking effort');
    expect(effort).toBeInTheDocument();
    expect(effort).toHaveTextContent('medium');
  });

  it('commits the temperature clamped to [0, 2] on blur', async () => {
    const user = userEvent.setup();
    const onTemperatureCommit = vi.fn();
    render(<Harness onTemperatureCommit={onTemperatureCommit} />);

    const input = screen.getByLabelText('Temperature');
    await user.clear(input);
    await user.type(input, '9');
    await user.tab();

    // 9 is out of range, so it is clamped to the max every provider accepts.
    expect(onTemperatureCommit).toHaveBeenLastCalledWith(2);
  });

  it('lets the user pick a different thinking effort', async () => {
    const user = userEvent.setup();
    render(<Harness initialReasoning />);

    await user.click(screen.getByLabelText('Thinking effort'));
    await user.click(await screen.findByRole('option', { name: 'high' }));

    expect(screen.getByLabelText('Thinking effort')).toHaveTextContent('high');
  });

  it('renders every control read-only when the Advanced section is locked', () => {
    render(<Harness initialTemperature={0.5} initialReasoning disabled />);

    expect(screen.getByLabelText('Temperature')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Toggle reasoning' })).toBeDisabled();
    expect(screen.getByLabelText('Thinking effort')).toBeDisabled();
  });
});
