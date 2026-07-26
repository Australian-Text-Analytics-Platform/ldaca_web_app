import { useState, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { providerConfigurationSecondaryText } from '../aiProviders';
import { AddAnnotationProviderDialog } from './AddAnnotationProviderDialog';
import { ModelNameCombobox } from './ModelNameCombobox';

interface AnnotationAiSettingsProps {
  configurations: AnnotationProviderConfigurationView[];
  selectedConfigurationId: string | null;
  onProviderChange: (configuration: AnnotationProviderConfigurationView, model: string) => void;
  onModelChange: (model: string) => void;
  onModelCommit: (configurationId: string, model: string) => void;
  providerModels: Record<string, string>;
  model: string;
  disabled?: boolean;
  children?: ReactNode;
  advanced?: ReactNode;
}

/** Named provider-configuration and model selection for Annotation requests. */
export function AnnotationAiSettings({
  configurations,
  selectedConfigurationId,
  onProviderChange,
  onModelChange,
  onModelCommit,
  providerModels,
  model,
  disabled,
  children,
  advanced,
}: AnnotationAiSettingsProps) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const selected =
    configurations.find((configuration) => configuration.id === selectedConfigurationId) ?? null;
  const selectedModel = selected ? model : '';

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
                  <span className="truncate font-medium">{selected.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {providerConfigurationSecondaryText(selected)}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Select a provider</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
            <div className="flex flex-col gap-1">
              {configurations.length === 0 ? (
                <p className="px-2 py-2 text-sm text-muted-foreground">No providers configured</p>
              ) : (
                configurations.map((configuration) => (
                  <button
                    key={configuration.id}
                    type="button"
                    className="rounded-sm px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      onProviderChange(configuration, providerModels[configuration.id] ?? '');
                      setOpen(false);
                    }}
                  >
                    <span className="block truncate text-sm font-medium">{configuration.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {providerConfigurationSecondaryText(configuration)}
                    </span>
                  </button>
                ))
              )}
              <div className="mt-1 border-t pt-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    setOpen(false);
                    setAddOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add Provider
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {selected ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="annotation-ai-model">Model</Label>
          <ModelNameCombobox
            id="annotation-ai-model"
            configuration={selected}
            value={selectedModel}
            onChange={onModelChange}
            onCommit={(next) => {
              onModelCommit(selected.id, next);
            }}
            disabled={disabled}
          />
        </div>
      ) : null}

      <AddAnnotationProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(configuration) => {
          onProviderChange(configuration, providerModels[configuration.id] ?? '');
        }}
      />

      {children}

      {advanced ? (
        <Collapsible defaultOpen={false} className="rounded-lg border bg-background/60">
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden [&[data-state=open]>svg]:rotate-180">
            Advanced
            <ChevronDown className="size-4 transition-transform duration-200" aria-hidden="true" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-4 border-t px-3 py-3">{advanced}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
