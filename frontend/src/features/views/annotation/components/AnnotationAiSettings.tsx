/**
 * AI-mode settings panel for the Annotation tab.
 *
 * Rendered by: AnnotationFeature, inside the AI section that appears when the
 * Manual/AI switch is flipped to "AI". It collects one configured provider card
 * (provider/category + API key + model) and advanced child settings. An optional
 * example-node selector is injected by the parent through `children`, since that
 * selector needs the parent's useTabNodeInputs wiring.
 *
 * Providers: the dropdown is instance-based rather than category-based. It is
 * empty until the user adds provider cards; each card shows the provider label
 * and model, with edit/delete actions. Saving a card persists credentials in
 * preferences and the card's model in tab settings through parent callbacks.
 */
import { useState, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AnnotationAiCustomProvider } from '@/api';
import {
  type AnnotationAiProviderId,
  getBuiltinProvider,
  parseConfiguredBuiltinProviderId,
} from '../aiProviders';
import {
  AnnotationProviderConfigDialog,
  type AnnotationProviderCard,
  type AnnotationProviderConfigSave,
} from './AnnotationProviderConfigDialog';

interface AnnotationAiSettingsProps {
  provider: AnnotationAiProviderId;
  onProviderChange: (provider: AnnotationAiProviderId, model: string) => void;
  /** Configured provider API keys from preferences, keyed by provider-card id. */
  apiKeys: Record<string, string>;
  /** Per-card model choices persisted in tab settings. */
  providerModels: Record<string, string>;
  /** User-saved custom provider cards from preferences, shown in the dropdown. */
  customProviders: readonly AnnotationAiCustomProvider[];
  /** Persist a provider card's key/custom definition/model, then select it. */
  onSaveProvider: (config: AnnotationProviderConfigSave) => void;
  /** Delete one configured provider card and clear any selected reference to it. */
  onDeleteProvider: (providerId: AnnotationAiProviderId) => void;
  /** Selected model, used only as a legacy fallback for older tab settings. */
  model: string;
  disabled?: boolean;
  /** Optional example-node selector, supplied by the parent feature. */
  children?: ReactNode;
}

function buildConfiguredProviderCards({
  apiKeys,
  providerModels,
  customProviders,
  selectedProvider,
  selectedModel,
}: {
  apiKeys: Record<string, string>;
  providerModels: Record<string, string>;
  customProviders: readonly AnnotationAiCustomProvider[];
  selectedProvider: AnnotationAiProviderId;
  selectedModel: string;
}): AnnotationProviderCard[] {
  const builtinCards = Object.entries(apiKeys).flatMap(([id, apiKey]) => {
    const builtinProviderId = parseConfiguredBuiltinProviderId(id);
    if (!builtinProviderId) return [];
    const provider = getBuiltinProvider(builtinProviderId);
    return [
      {
        id,
        label: provider.label,
        model: providerModels[id] ?? (selectedProvider === id ? selectedModel : ''),
        apiKey,
        builtinProviderId,
      },
    ];
  });
  const customCards = customProviders.map((definition) => ({
    id: definition.id,
    label: definition.name,
    model:
      providerModels[definition.id] ?? (selectedProvider === definition.id ? selectedModel : ''),
    apiKey: apiKeys[definition.id] ?? '',
    customProvider: definition,
  }));
  return [...builtinCards, ...customCards];
}

export function AnnotationAiSettings({
  provider,
  onProviderChange,
  apiKeys,
  providerModels,
  customProviders,
  onSaveProvider,
  onDeleteProvider,
  model,
  disabled,
  children,
}: AnnotationAiSettingsProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialog, setDialog] = useState<{
    open: boolean;
    provider: AnnotationProviderCard | null;
  }>({ open: false, provider: null });

  const providerCards = buildConfiguredProviderCards({
    apiKeys,
    providerModels,
    customProviders,
    selectedProvider: provider,
    selectedModel: model,
  });
  const selectedCard = providerCards.find((card) => card.id === provider);
  const openAddDialog = () => {
    setDialog({ open: true, provider: null });
    setDropdownOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="annotation-ai-provider">Provider</Label>
        <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <PopoverTrigger asChild>
            <Button
              id="annotation-ai-provider"
              type="button"
              variant="outline"
              aria-label="Provider"
              disabled={disabled}
              className="h-auto w-full justify-between px-3 py-2 text-left"
            >
              {selectedCard ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{selectedCard.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {selectedCard.model || 'No model selected'}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Select or add a provider</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
            <div className="flex flex-col gap-2">
              {providerCards.map((card) => (
                <div key={card.id} className="rounded-md border border-border/70 bg-card p-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        onProviderChange(card.id, card.model);
                        setDropdownOpen(false);
                      }}
                    >
                      <span className="block truncate text-sm font-medium">{card.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {card.model || 'No model selected'}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${card.label}`}
                      onClick={() => {
                        setDialog({ open: true, provider: card });
                        setDropdownOpen(false);
                      }}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${card.label}`}
                      onClick={() => {
                        onDeleteProvider(card.id);
                        setDropdownOpen(false);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={openAddDialog}
              >
                <Plus data-icon="inline-start" />
                Add provider
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {children}

      <AnnotationProviderConfigDialog
        open={dialog.open}
        provider={dialog.provider}
        onOpenChange={(open) => {
          setDialog((current) => ({ open, provider: open ? current.provider : null }));
        }}
        onSave={onSaveProvider}
      />
    </div>
  );
}

export default AnnotationAiSettings;
