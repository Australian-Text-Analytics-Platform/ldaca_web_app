import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QuotationEngineConfigInput } from '@/api/generated/types.gen';
import { QuotationEngineSettingsFields } from '../QuotationEngineSettingsFields';

describe('QuotationEngineSettingsFields', () => {
  it('shows the endpoint input only when remote is selected', async () => {
    const user = userEvent.setup();
    const onEngineConfigChange = vi.fn();
    const onRemoteUrlChange = vi.fn();

    function Harness() {
      const [engineConfig, setEngineConfig] = useState<QuotationEngineConfigInput>({
        type: 'local',
      });
      const [lastRemoteUrl, setLastRemoteUrl] = useState('https://saved.example/quotation');
      return (
        <QuotationEngineSettingsFields
          idPrefix="test-quotation-engine"
          engineConfig={engineConfig}
          lastRemoteUrl={lastRemoteUrl}
          onEngineConfigChange={(config) => {
            onEngineConfigChange(config);
            setEngineConfig(config);
          }}
          onRemoteUrlChange={(url) => {
            onRemoteUrlChange(url);
            setLastRemoteUrl(url);
            setEngineConfig({ type: 'remote', url });
          }}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('radio', { name: /built-in/i })).toBeChecked();
    expect(screen.queryByLabelText('Endpoint')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /remote/i }));

    expect(onEngineConfigChange).toHaveBeenCalledWith({
      type: 'remote',
      url: 'https://saved.example/quotation',
    });

    expect(screen.getByLabelText('Endpoint')).toHaveValue('https://saved.example/quotation');
    await user.clear(screen.getByLabelText('Endpoint'));
    await user.type(screen.getByLabelText('Endpoint'), 'https://new.example/api');

    expect(onRemoteUrlChange).toHaveBeenLastCalledWith('https://new.example/api');
  });
});