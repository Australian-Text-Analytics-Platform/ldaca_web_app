import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QuotationEngineConfig } from '@/api';
import { QuotationEngineSettingsFields } from '../QuotationEngineSettingsFields';

describe('QuotationEngineSettingsFields', () => {
  it('shows the endpoint input only when remote is selected', async () => {
    const user = userEvent.setup();
    const onEngineConfigChange = vi.fn();
    const onRemoteEngineIdChange = vi.fn();

    function Harness() {
      const [engineConfig, setEngineConfig] = useState<QuotationEngineConfig>({
        type: 'local',
      });
      const [lastRemoteEngineId, setLastRemoteEngineId] = useState('remote-quotation-engine');
      return (
        <QuotationEngineSettingsFields
          idPrefix="test-quotation-engine"
          engineConfig={engineConfig}
          lastRemoteEngineId={lastRemoteEngineId}
          onEngineConfigChange={(config) => {
            onEngineConfigChange(config);
            setEngineConfig(config);
          }}
          onRemoteEngineIdChange={(engineId) => {
            onRemoteEngineIdChange(engineId);
            setLastRemoteEngineId(engineId);
            setEngineConfig({ type: 'remote', engine_id: engineId });
          }}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('radio', { name: /built-in/i })).toBeChecked();
    expect(screen.queryByLabelText('Engine id')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /remote/i }));

    expect(onEngineConfigChange).toHaveBeenCalledWith({
      type: 'remote',
      engine_id: 'remote-quotation-engine',
    });

    expect(screen.getByLabelText('Engine id')).toHaveValue('remote-quotation-engine');
    await user.clear(screen.getByLabelText('Engine id'));
    await user.type(screen.getByLabelText('Engine id'), 'remote-engine-v2');

    expect(onRemoteEngineIdChange).toHaveBeenLastCalledWith('remote-engine-v2');
  });
});
