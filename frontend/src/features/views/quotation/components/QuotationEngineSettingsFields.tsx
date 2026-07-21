import type { QuotationEngineConfig, QuotationEngineType } from '@/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface QuotationEngineSettingsFieldsProps {
  idPrefix: string;
  engineConfig: QuotationEngineConfig;
  lastRemoteEngineId: string;
  error?: string | null;
  onEngineConfigChange: (config: QuotationEngineConfig) => void;
  onRemoteEngineIdChange: (engineId: string) => void;
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
 * The backend task request stores `local`/`remote` plus an optional engine id;
 * the UI presents those choices as Built-in/Remote radios with the id input
 * mounted only while Remote is active.
 * Used by: QuotationFeature because each quotation tab needs local task-level engine controls.
 * Flow: derive the selected engine, switch local task config from radio changes,
 * and keep the in-task remote engine id synchronized from the conditional input.
 */
export function QuotationEngineSettingsFields({
  idPrefix,
  engineConfig,
  lastRemoteEngineId,
  error,
  onEngineConfigChange,
  onRemoteEngineIdChange,
  className,
}: QuotationEngineSettingsFieldsProps) {
  const selectedType = engineConfig.type ?? 'local';
  const engineIdValue =
    engineConfig.type === 'remote' ? (engineConfig.engine_id ?? '') : lastRemoteEngineId;

  /** Called by: quotation engine radio inputs because the parameter panel needs one local update path for task engine changes. */
  const handleTypeChange = (nextType: QuotationEngineType) => {
    if (nextType === 'remote') {
      const restoredEngineId =
        lastRemoteEngineId.length > 0 ? lastRemoteEngineId : (engineConfig.engine_id ?? '');
      onEngineConfigChange({ type: 'remote', engine_id: restoredEngineId });
      return;
    }
    onEngineConfigChange({ type: 'local' });
  };

  /** Called by: the remote engine id input because changes update both remembered and active task state. */
  const handleEngineIdChange = (value: string) => {
    onRemoteEngineIdChange(value);
    if (selectedType !== 'remote') {
      onEngineConfigChange({ type: 'remote', engine_id: value });
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
                onChange={() => {
                  handleTypeChange(option.value);
                }}
                className="h-4 w-4 accent-primary"
              />
              <span>{option.label}</span>
            </Label>
          );
        })}
      </div>
      {selectedType === 'remote' ? (
        <div className="max-w-xl space-y-2">
          <Label htmlFor={`${idPrefix}-engine-id`}>Engine id</Label>
          <Input
            id={`${idPrefix}-engine-id`}
            type="text"
            value={engineIdValue}
            onChange={(event) => {
              handleEngineIdChange(event.target.value);
            }}
            placeholder="remote-quotation-engine"
            aria-invalid={error ? true : undefined}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
