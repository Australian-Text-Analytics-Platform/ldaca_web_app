import type { QuotationEngineConfigInput, QuotationEngineType } from '@/api/generated/types.gen';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface QuotationEngineSettingsFieldsProps {
  idPrefix: string;
  engineConfig: QuotationEngineConfigInput;
  lastRemoteUrl: string;
  error?: string | null;
  onEngineConfigChange: (config: QuotationEngineConfigInput) => void;
  onRemoteUrlChange: (url: string) => void;
  className?: string;
}

const ENGINE_OPTIONS: { value: QuotationEngineType; label: string; description: string }[] = [
  {
    value: 'local',
    label: 'Built-in',
    description: 'Use the bundled quotation engine.',
  },
  {
    value: 'remote',
    label: 'Remote',
    description: 'Send quotation extraction to a remote service endpoint.',
  },
];

/**
 * Quotation engine task parameter fields used by the Quotation parameter panel.
 * The backend task request stores `local`/`remote`; the UI presents those choices
 * as Built-in/Remote radios with the endpoint input mounted only while Remote is active.
 * Used by: QuotationFeature because each quotation tab needs local task-level engine controls.
 * Flow: derive the selected engine, switch local task config from radio changes, and keep the in-task remote endpoint synchronized from the conditional input.
 */
export function QuotationEngineSettingsFields({
  idPrefix,
  engineConfig,
  lastRemoteUrl,
  error,
  onEngineConfigChange,
  onRemoteUrlChange,
  className,
}: QuotationEngineSettingsFieldsProps) {
  const selectedType = engineConfig.type ?? 'local';
  const endpointValue = engineConfig.type === 'remote' ? engineConfig.url ?? '' : lastRemoteUrl;

  /** Called by: quotation engine radio inputs because the parameter panel needs one local update path for task engine changes. */
  const handleTypeChange = (nextType: QuotationEngineType) => {
    if (nextType === 'remote') {
      const restoredUrl = lastRemoteUrl.length > 0 ? lastRemoteUrl : engineConfig.url ?? '';
      onEngineConfigChange({ type: 'remote', url: restoredUrl });
      return;
    }
    onEngineConfigChange({ type: 'local' });
  };

  /** Called by: the remote endpoint input because remote URL changes must update both remembered and active task engine state. */
  const handleEndpointChange = (value: string) => {
    onRemoteUrlChange(value);
    if (selectedType !== 'remote') {
      onEngineConfigChange({ type: 'remote', url: value });
    }
  };

  return (
    <fieldset className={cn('space-y-3', className)}>
      <legend className="block text-sm font-medium text-foreground">Quotation engine</legend>
      <div className="flex flex-wrap gap-4">
        {ENGINE_OPTIONS.map((option) => {
          const inputId = `${idPrefix}-${option.value}`;
          const checked = selectedType === option.value;
          return (
            <Label
              key={option.value}
              htmlFor={inputId}
              className={cn(
                'flex cursor-pointer items-center gap-2 text-sm font-normal text-foreground',
                checked ? 'font-medium' : null,
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={`${idPrefix}-quotation-engine`}
                value={option.value}
                checked={checked}
                onChange={() => { handleTypeChange(option.value); }}
                className="h-4 w-4 accent-primary"
              />
              <span>{option.label}</span>
            </Label>
          );
        })}
      </div>
      {selectedType === 'remote' ? (
        <div className="max-w-xl space-y-2">
          <Label htmlFor={`${idPrefix}-endpoint`}>Endpoint</Label>
          <Input
            id={`${idPrefix}-endpoint`}
            type="url"
            value={endpointValue}
            onChange={(event) => { handleEndpointChange(event.target.value); }}
            placeholder="https://quotation.example/api"
            aria-invalid={error ? true : undefined}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}