import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Float64, Int64, Utf8 } from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import { SequentialAnalysisParameterPanel } from '../SequentialAnalysisParameterPanel';

vi.mock('@/components/help/HelpIcon', () => ({ default: () => null }));
vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  NodeInputsPanel: () => null,
}));

window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('SequentialAnalysisParameterPanel', () => {
  it('shows friendly canonical Arrow types and unchanged alternate types in group-by options', async () => {
    const user = userEvent.setup();

    render(
      <SequentialAnalysisParameterPanel
        nodeInputs={{} as UseTabNodeInputsResult}
        onColumnChange={vi.fn()}
        derivedColumnType="numeric"
        inputsDisabled={false}
        activeNodeId="node-1"
        selectedNodeId="node-1"
        currentWorkspaceId="workspace-1"
        frequency="daily"
        onFrequencyChange={vi.fn()}
        customIntervalValueInput="1"
        onCustomIntervalValueChange={vi.fn()}
        customIntervalUnit="days"
        onCustomIntervalUnitChange={vi.fn()}
        numericOriginInput=""
        onNumericOriginChange={vi.fn()}
        numericIntervalInput="1"
        onNumericIntervalChange={vi.fn()}
        availableColumns={[
          { name: 'count', typeName: 'Int64', field: new Field('count', new Int64()) },
          { name: 'score', typeName: 'Float64', field: new Field('score', new Float64()) },
          { name: 'legacy_text', typeName: 'Utf8', field: new Field('legacy_text', new Utf8()) },
        ]}
        groupByColumns={['']}
        onAddGroupByColumn={vi.fn()}
        onRemoveGroupByColumn={vi.fn()}
        onGroupByColumnChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'count (integer)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'score (float)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'legacy_text (Utf8)' })).toBeInTheDocument();
  });
});
