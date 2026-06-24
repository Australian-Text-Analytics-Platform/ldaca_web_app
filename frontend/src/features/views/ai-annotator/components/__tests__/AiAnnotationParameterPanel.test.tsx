import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import { AiAnnotationParameterPanel } from '../AiAnnotationParameterPanel';

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  NodeInputsPanel: () => <div data-testid="node-inputs-panel" />,
}));

const nodeInputs = {
  resolvedNodes: [],
  availableNodes: [],
  graphSelectedIds: [],
  recentPresets: [],
  canAddMore: true,
  addNodes: vi.fn(),
  getAddRejection: vi.fn(() => null),
  removeNode: vi.fn(),
  clear: vi.fn(),
  setColumn: vi.fn(),
  inputs: [],
  selectedNodes: [],
  nodeColumnSelections: [],
  workspaceId: 'workspace-1',
} as unknown as UseTabNodeInputsResult;

function setupPanel(overrides: Partial<Parameters<typeof AiAnnotationParameterPanel>[0]> = {}) {
  const props = {
    nodeInputs,
    textColumn: 'text',
    textColumns: [{ name: 'text', dataType: 'string' }],
    annotationColumn: '',
    annotationColumns: [{ name: 'annotation', dataType: 'annotation' }],
    endpointPreset: 'openai' as const,
    model: 'gpt-test',
    modelNames: ['gpt-test'],
    isLoadingModels: false,
    customBaseUrl: '',
    apiKey: '',
    classesText: 'support: Supportive stance',
    examplesText: '',
    temperature: '1.0',
    topP: '1.0',
    seed: '42',
    batchSize: '100',
    onNodeColumnChange: vi.fn(),
    onTextColumnChange: vi.fn(),
    onAnnotationColumnChange: vi.fn(),
    onEndpointPresetChange: vi.fn(),
    onModelChange: vi.fn(),
    onCustomBaseUrlChange: vi.fn(),
    onApiKeyChange: vi.fn(),
    onClassesTextChange: vi.fn(),
    onExamplesTextChange: vi.fn(),
    onTemperatureChange: vi.fn(),
    onTopPChange: vi.fn(),
    onSeedChange: vi.fn(),
    onBatchSizeChange: vi.fn(),
    ...overrides,
  };
  render(<AiAnnotationParameterPanel {...props} />);
  return props;
}

describe('AiAnnotationParameterPanel', () => {
  it('renders common controls and forwards class text edits', () => {
    const panelProps = setupPanel();

    expect(screen.getByTestId('node-inputs-panel')).toBeInTheDocument();
    expect(screen.getByText('Commonly Used Parameters')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Classes/), {
      target: { value: 'critical: Critical stance' },
    });

    expect(panelProps.onClassesTextChange).toHaveBeenCalledWith('critical: Critical stance');
  });

  it('shows custom endpoint URL only for the custom provider', () => {
    setupPanel({ endpointPreset: 'openai' });
    expect(screen.queryByLabelText('Custom Base URL')).not.toBeInTheDocument();

    setupPanel({ endpointPreset: 'custom', customBaseUrl: 'http://localhost:11434/v1' });
    expect(screen.getByLabelText('Custom Base URL')).toHaveValue('http://localhost:11434/v1');
  });

  it('keeps advanced fields collapsed until requested', () => {
    const panelProps = setupPanel();

    expect(screen.queryByLabelText('Temperature')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Advanced Parameters/ }));
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText(/Examples/), {
      target: { value: 'sample text => support' },
    });

    expect(panelProps.onTemperatureChange).toHaveBeenCalledWith('0.5');
    expect(panelProps.onExamplesTextChange).toHaveBeenCalledWith('sample text => support');
  });
});
