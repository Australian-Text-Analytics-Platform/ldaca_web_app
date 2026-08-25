import { ChevronDown, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { canListModels, providerConfigurationSecondaryText } from '../aiProviders';
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
  onAdvancedOpenChange?: (open: boolean) => void;
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
  onAdvancedOpenChange,
}: AnnotationAiSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const selected =
    configurations.find((configuration) => configuration.id === selectedConfigurationId) ?? null;
  const selectedModel = selected ? model : '';
  const selectedNeedsKey = Boolean(selected && !canListModels(selected));
  const selectedProviderSummary = selected
    ? `${selected.name} ${selectedNeedsKey ? 'Needs API key' : providerConfigurationSecondaryText(selected)}`
    : 'No provider selected';
  const selectedModelSummary = selectedModel || 'No model selected';

  return (
    <div className="flex flex-col gap-4">
      {children}

      <Collapsible
        open={advancedOpen}
        onOpenChange={(open) => {
          setAdvancedOpen(open);
          onAdvancedOpenChange?.(open);
        }}
        className="relative rounded-lg border bg-editor/60"
      >
        <CollapsibleTrigger
          data-guidance="annotation-ai-settings-trigger"
          aria-label="Advanced settings"
          title={advancedOpen ? 'Collapse advanced settings' : 'Expand advanced settings'}
          className="group grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-body transition-colors duration-300 ease-out hover:bg-panel/30 focus-visible:outline-hidden data-[state=closed]:w-full data-[state=open]:absolute data-[state=open]:top-2 data-[state=open]:right-2 data-[state=open]:z-10 data-[state=open]:size-7 data-[state=open]:grid-cols-1 data-[state=open]:gap-0 data-[state=open]:p-0 motion-reduce:transition-none"
        >
          {advancedOpen ? null : (
            <>
              <span
                className="flex min-w-0 items-baseline gap-2 text-left"
                title={selectedProviderSummary}
              >
                {selected ? (
                  <>
                    <span className="truncate font-medium">{selected.name}</span>
                    <span className="truncate text-label-secondary text-description">
                      {selectedNeedsKey
                        ? 'Needs API key'
                        : providerConfigurationSecondaryText(selected)}
                    </span>
                  </>
                ) : (
                  <span className="truncate font-medium">No provider selected</span>
                )}
              </span>
              <span className="truncate text-left text-description" title={selectedModelSummary}>
                {selectedModelSummary}
              </span>
            </>
          )}
          <span className="inline-flex size-7 items-center justify-center rounded-md border bg-editor group-data-[state=open]:border-0 group-data-[state=open]:bg-transparent">
            <ChevronDown
              className="size-4 transition-transform duration-300 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent
          forceMount
          inert={!advancedOpen}
          aria-hidden={!advancedOpen}
          className="grid overflow-hidden opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr] data-[state=open]:opacity-100 motion-reduce:transition-none"
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-4 px-3 py-3">
              <div
                data-guidance="annotation-ai-provider-model"
                className="grid grid-cols-2 items-end gap-3"
                data-testid="annotation-ai-provider-model-controls"
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="annotation-ai-provider">Provider</Label>
                  <Popover open={providerOpen} onOpenChange={setProviderOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="annotation-ai-provider"
                        type="button"
                        variant="outline"
                        disabled={disabled}
                        className="h-10 w-full justify-start px-3 text-left"
                      >
                        {selected ? (
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate font-medium">{selected.name}</span>
                            <span className="truncate text-label-secondary text-description">
                              {selectedNeedsKey
                                ? 'Needs API key'
                                : providerConfigurationSecondaryText(selected)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-description">Select a provider</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-2"
                    >
                      <div className="flex flex-col gap-1">
                        {configurations.length === 0 ? (
                          <p className="px-2 py-2 text-body text-description">
                            No providers configured
                          </p>
                        ) : (
                          configurations.map((configuration) => (
                            <button
                              key={configuration.id}
                              type="button"
                              disabled={!canListModels(configuration)}
                              className="flex min-w-0 items-baseline gap-2 rounded-sm px-2 py-2 text-left hover:bg-list-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-inherit"
                              onClick={() => {
                                onProviderChange(
                                  configuration,
                                  providerModels[configuration.id] ?? '',
                                );
                                setProviderOpen(false);
                              }}
                            >
                              <span className="truncate text-body font-medium">
                                {configuration.name}
                              </span>
                              <span className="truncate text-label-secondary text-description">
                                {canListModels(configuration)
                                  ? providerConfigurationSecondaryText(configuration)
                                  : 'Needs API key'}
                              </span>
                            </button>
                          ))
                        )}
                        <div className="mt-1 border-t pt-1">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-body font-medium hover:bg-list-hover hover:text-foreground"
                            onClick={() => {
                              setProviderOpen(false);
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
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="annotation-ai-model">Model</Label>
                    <ModelNameCombobox
                      id="annotation-ai-model"
                      configuration={selected}
                      value={selectedModel}
                      onChange={onModelChange}
                      onCommit={(next) => {
                        onModelCommit(selected.id, next);
                      }}
                      disabled={(disabled ?? false) || selectedNeedsKey}
                    />
                    {selectedNeedsKey ? (
                      <p className="text-label-secondary text-error">
                        Add an API key in Settings → AI before listing models or running Annotation.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {advanced}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AddAnnotationProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(configuration) => {
          if (canListModels(configuration)) {
            onProviderChange(configuration, providerModels[configuration.id] ?? '');
          }
        }}
      />
    </div>
  );
}
