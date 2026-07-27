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
  initialMaxRetriesPerBatch = 2,
  initialBatchSize = 20,
  initialProcessingMode = 'reprocess_all',
  initialReasoning = false,
  initialEffort = 'medium',
  disabled = false,
  onTemperatureCommit = vi.fn(),
  onMaxRetriesPerBatchCommit = vi.fn(),
  onBatchSizeCommit = vi.fn(),
  onProcessingModeChange = vi.fn(),
}: {
  initialTemperature?: number;
  initialMaxRetriesPerBatch?: number;
  initialBatchSize?: number;
  initialProcessingMode?: 'reprocess_all' | 'fill_missing';
  initialReasoning?: boolean;
  initialEffort?: string;
  disabled?: boolean;
  onTemperatureCommit?: (value: number) => void;
  onMaxRetriesPerBatchCommit?: (value: number) => void;
  onBatchSizeCommit?: (value: number) => void;
  onProcessingModeChange?: (value: 'reprocess_all' | 'fill_missing') => void;
}) {
  const [temperature, setTemperature] = useState(initialTemperature);
  const [maxRetriesPerBatch, setMaxRetriesPerBatch] = useState(initialMaxRetriesPerBatch);
  const [batchSize, setBatchSize] = useState(initialBatchSize);
  const [processingMode, setProcessingMode] = useState(initialProcessingMode);
  const [reasoningEnabled, setReasoningEnabled] = useState(initialReasoning);
  const [reasoningEffort, setReasoningEffort] = useState(initialEffort);
  return (
    <AnnotationInferenceSettings
      temperature={temperature}
      onTemperatureCommit={(value) => {
        setTemperature(value);
        onTemperatureCommit(value);
      }}
      maxRetriesPerBatch={maxRetriesPerBatch}
      onMaxRetriesPerBatchCommit={(value) => {
        setMaxRetriesPerBatch(value);
        onMaxRetriesPerBatchCommit(value);
      }}
      batchSize={batchSize}
      onBatchSizeCommit={(value) => {
        setBatchSize(value);
        onBatchSizeCommit(value);
      }}
      processingMode={processingMode}
      onProcessingModeChange={(value) => {
        setProcessingMode(value);
        onProcessingModeChange(value);
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
    expect(screen.getByLabelText('Max retries per batch')).toHaveValue(2);
    expect(screen.getByLabelText('Batch size')).toHaveValue(20);
    expect(screen.getByRole('radio', { name: 'Reprocess all rows' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Fill missing only' })).not.toBeChecked();
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

  it('commits an integer retry count clamped to [0, 10] on blur', async () => {
    const user = userEvent.setup();
    const onMaxRetriesPerBatchCommit = vi.fn();
    render(<Harness onMaxRetriesPerBatchCommit={onMaxRetriesPerBatchCommit} />);

    const input = screen.getByLabelText('Max retries per batch');
    await user.clear(input);
    await user.type(input, '12.8');
    await user.tab();

    expect(onMaxRetriesPerBatchCommit).toHaveBeenLastCalledWith(10);
  });

  it('commits an integer batch size clamped to [1, 100] on blur', async () => {
    const user = userEvent.setup();
    const onBatchSizeCommit = vi.fn();
    render(<Harness onBatchSizeCommit={onBatchSizeCommit} />);

    const input = screen.getByLabelText('Batch size');
    await user.clear(input);
    await user.type(input, '150.8');
    await user.tab();

    expect(onBatchSizeCommit).toHaveBeenLastCalledWith(100);
  });

  it('lets the user pick a different thinking effort', async () => {
    const user = userEvent.setup();
    render(<Harness initialReasoning />);

    await user.click(screen.getByLabelText('Thinking effort'));
    await user.click(await screen.findByRole('option', { name: 'high' }));

    expect(screen.getByLabelText('Thinking effort')).toHaveTextContent('high');
  });

  it('lets the user resume by filling only missing annotations', async () => {
    const user = userEvent.setup();
    const onProcessingModeChange = vi.fn();
    render(<Harness onProcessingModeChange={onProcessingModeChange} />);

    await user.click(screen.getByRole('radio', { name: 'Fill missing only' }));

    expect(onProcessingModeChange).toHaveBeenCalledWith('fill_missing');
    expect(screen.getByRole('radio', { name: 'Fill missing only' })).toBeChecked();
  });

  it('renders every control read-only when the Advanced section is locked', () => {
    render(<Harness initialTemperature={0.5} initialReasoning disabled />);

    expect(screen.getByLabelText('Temperature')).toBeDisabled();
    expect(screen.getByLabelText('Max retries per batch')).toBeDisabled();
    expect(screen.getByLabelText('Batch size')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Reprocess all rows' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Fill missing only' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Toggle reasoning' })).toBeDisabled();
    expect(screen.getByLabelText('Thinking effort')).toBeDisabled();
  });
});
