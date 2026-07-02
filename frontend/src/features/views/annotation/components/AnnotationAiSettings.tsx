/**
 * AI-mode settings panel for the Annotation tab.
 *
 * Rendered by: AnnotationFeature, inside the AI section that appears when the
 * Manual/AI switch is flipped to "AI". It collects the provider, the API key
 * used both to list models and (later) to call the provider, and the model name
 * (via the filterable ModelNameCombobox). An optional example-node selector is
 * injected by the parent through `children`, since that selector needs the
 * parent's useTabNodeInputs wiring.
 *
 * Providers: the dropdown lists the built-in catalogue plus any user-saved
 * custom providers (passed in via `customProviders`), followed by a "Custom…"
 * sentinel entry that opens CustomProviderDialog to register another. Saving a
 * custom provider persists it to preferences (handled by the parent through
 * `onAddCustomProvider`) and selects it.
 *
 * API key: the field is uncontrolled and seeded from the committed `apiKey`
 * (per provider), re-seeding via its React `key` when the provider or stored key
 * changes. It commits to preferences on blur through `onApiKeyCommit`, matching
 * the "save on blur" behaviour the user asked for.
 */
import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnnotationAiCustomProvider } from '@/api';
import {
  type AnnotationAiProviderId,
  buildAnnotationAiProviders,
  resolveAnnotationAiProvider,
} from '../aiProviders';
import { ModelNameCombobox } from './ModelNameCombobox';
import { CustomProviderDialog } from './CustomProviderDialog';

/** Sentinel Select value that opens the custom-provider dialog (not a real id). */
const ADD_CUSTOM_PROVIDER_VALUE = '__add_custom_provider__';

interface AnnotationAiSettingsProps {
  provider: AnnotationAiProviderId;
  onProviderChange: (provider: AnnotationAiProviderId) => void;
  /** User-saved custom providers from preferences, shown in the dropdown. */
  customProviders: readonly AnnotationAiCustomProvider[];
  /** Persist + select a newly defined custom provider. */
  onAddCustomProvider: (provider: AnnotationAiCustomProvider) => void;
  /** Committed API key for the active provider (seeds the field + feeds the combobox). */
  apiKey: string;
  /** Commit the API key to preferences (called on blur). */
  onApiKeyCommit: (apiKey: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  /** Persist the model id to durable state (called on blur / model pick). */
  onModelCommit?: (model: string) => void;
  disabled?: boolean;
  /** Optional example-node selector, supplied by the parent feature. */
  children?: ReactNode;
}

export function AnnotationAiSettings({
  provider,
  onProviderChange,
  customProviders,
  onAddCustomProvider,
  apiKey,
  onApiKeyCommit,
  model,
  onModelChange,
  onModelCommit,
  disabled,
  children,
}: AnnotationAiSettingsProps) {
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  const providers = buildAnnotationAiProviders(customProviders);
  const activeProvider = resolveAnnotationAiProvider(provider, customProviders);
  // OpenRouter lists models without a key and custom providers have no listing
  // endpoint, so only the keyed built-ins must have a key before the dropdown works.
  const apiKeyRequired = activeProvider.requiresApiKey;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="annotation-ai-provider">Provider</Label>
          <Select
            value={provider}
            disabled={disabled}
            onValueChange={(next) => {
              // The sentinel opens the dialog instead of selecting a provider.
              if (next === ADD_CUSTOM_PROVIDER_VALUE) {
                setCustomDialogOpen(true);
                return;
              }
              onProviderChange(next);
            }}
          >
            <SelectTrigger id="annotation-ai-provider" aria-label="Provider" className="w-full">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={ADD_CUSTOM_PROVIDER_VALUE}>Custom…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="annotation-ai-api-key">
            API Key
            {apiKeyRequired ? null : (
              <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            )}
          </Label>
          <Input
            // Re-seed the uncontrolled field whenever the provider or the stored
            // key changes (provider switch, preferences hydration, save on blur).
            key={`annotation-ai-api-key-${provider}-${apiKey}`}
            id="annotation-ai-api-key"
            type="password"
            defaultValue={apiKey}
            disabled={disabled}
            placeholder={apiKeyRequired ? 'Required to list and use models' : 'Optional'}
            autoComplete="off"
            onBlur={(event) => {
              onApiKeyCommit(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="annotation-ai-model">Model</Label>
        <ModelNameCombobox
          id="annotation-ai-model"
          provider={activeProvider}
          apiKey={apiKey}
          value={model}
          onChange={onModelChange}
          onCommit={onModelCommit}
          disabled={disabled}
        />
        {apiKeyRequired && apiKey.trim().length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Enter an API key to browse available models, or type a model name directly.
          </p>
        ) : null}
      </div>

      {children}

      <CustomProviderDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onSave={onAddCustomProvider}
      />
    </div>
  );
}

export default AnnotationAiSettings;
