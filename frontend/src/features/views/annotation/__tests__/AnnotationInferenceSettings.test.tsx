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
  it('is collapsed by default so the temperature control is hidden', () => {
    render(<Harness />);
    // The section header is always visible, but the body stays collapsed until
    // the user opens it (Radix unmounts closed content in jsdom).
    expect(screen.getByText('Model Configuration')).toBeInTheDocument();
    expect(screen.queryByLabelText('Temperature')).not.toBeInTheDocument();
  });

  it('reveals temperature and the reasoning toggle when expanded', async () => {
    const user = userEvent.setup();
    render(<Harness initialTemperature={0.5} />);

    await user.click(screen.getByText('Model Configuration'));

    expect(screen.getByLabelText('Temperature')).toHaveValue(0.5);
    expect(screen.getByRole('switch', { name: 'Toggle reasoning' })).not.toBeChecked();
    // Thinking effort stays hidden while reasoning is off.
    expect(screen.queryByLabelText('Thinking effort')).not.toBeInTheDocument();
  });

  it('shows the thinking-effort select only after reasoning is enabled', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText('Model Configuration'));
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

    await user.click(screen.getByText('Model Configuration'));
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

    await user.click(screen.getByText('Model Configuration'));
    await user.click(screen.getByLabelText('Thinking effort'));
    await user.click(await screen.findByRole('option', { name: 'high' }));

    expect(screen.getByLabelText('Thinking effort')).toHaveTextContent('high');
  });

  it('stays expandable when locked but renders every control read-only', async () => {
    const user = userEvent.setup();
    render(<Harness initialTemperature={0.5} initialReasoning disabled />);

    // Locking the parameter panel no longer blocks the disclosure — the user can
    // still open it to inspect the settings a run is using…
    await user.click(screen.getByText('Model Configuration'));

    // …but every inner control is disabled so the locked values can't be edited.
    expect(screen.getByLabelText('Temperature')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Toggle reasoning' })).toBeDisabled();
    expect(screen.getByLabelText('Thinking effort')).toBeDisabled();
  });
});
