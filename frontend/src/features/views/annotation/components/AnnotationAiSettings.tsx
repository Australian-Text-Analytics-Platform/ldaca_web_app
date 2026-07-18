import { useState, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ANNOTATION_AI_PROVIDERS,
  getBuiltinProvider,
  type AnnotationAiProviderId,
  type BuiltinAnnotationAiProviderId,
} from '../aiProviders';
import { ModelNameCombobox } from './ModelNameCombobox';

interface AnnotationAiSettingsProps {
  workspaceId: string | null;
  provider: AnnotationAiProviderId;
  onProviderChange: (provider: AnnotationAiProviderId, model: string) => void;
  configuredProviders: Partial<Record<BuiltinAnnotationAiProviderId, boolean>>;
  providerModels: Record<string, string>;
  model: string;
  disabled?: boolean;
  children?: ReactNode;
}

/** Provider/model selection for the stateless annotation preview contract. */
export function AnnotationAiSettings({
  workspaceId,
  provider,
  onProviderChange,
  configuredProviders,
  providerModels,
  model,
  disabled,
  children,
}: AnnotationAiSettingsProps) {
  const [open, setOpen] = useState(false);
  const selected = ANNOTATION_AI_PROVIDERS.find((item) => item.id === provider);
  const selectedConfigured = selected ? configuredProviders[selected.id] === true : false;
  const selectedModel = providerModels[provider] ?? model;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="annotation-ai-provider">Provider</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="annotation-ai-provider"
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-auto w-full justify-between px-3 py-2 text-left"
            >
              {selected ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{selected.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {selectedConfigured
                      ? selectedModel || 'No model selected'
                      : 'Configure in Settings'}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Select a provider</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
            <div className="flex flex-col gap-1">
              {ANNOTATION_AI_PROVIDERS.map((item) => {
                const configured = configuredProviders[item.id] === true;
                const itemModel = providerModels[item.id] ?? '';
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="rounded-sm px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      onProviderChange(item.id, itemModel);
                      setOpen(false);
                    }}
                  >
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {configured ? itemModel || 'Choose a model below' : 'Configure in Settings'}
                    </span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {selected ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="annotation-ai-model">Model</Label>
          <ModelNameCombobox
            workspaceId={workspaceId}
            id="annotation-ai-model"
            provider={getBuiltinProvider(selected.id)}
            credentialConfigured={selectedConfigured}
            value={selectedModel}
            onChange={(next) => {
              onProviderChange(selected.id, next);
            }}
            onCommit={(next) => {
              onProviderChange(selected.id, next);
            }}
          />
          {!selectedConfigured ? (
            <p className="text-xs text-muted-foreground">
              Add this provider's credential in Settings → AI before previewing.
            </p>
          ) : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}
