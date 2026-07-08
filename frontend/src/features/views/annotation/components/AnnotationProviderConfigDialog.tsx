/**
 * Dialog for adding or editing one configured Annotation AI provider card.
 *
 * Rendered by: AnnotationAiSettings when the provider dropdown's "Add provider"
 * button or a card's Edit action is used. It turns the old provider-category
 * workflow into provider instances: each saved card owns one backend provider
 * category (or custom OpenAI-compatible base URL), API key, and model selection.
 *
 * Flow: choose a built-in category or custom endpoint, enter the credential,
 * pick/type a model through ModelNameCombobox, then emit a single save payload
 * that the parent persists into preferences (keys/custom endpoints) and tab
 * settings (per-card model).
 */
import { useState } from 'react';
import type { AnnotationAiCustomProvider } from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ANNOTATION_AI_PROVIDERS,
  DEFAULT_ANNOTATION_AI_PROVIDER_ID,
  generateConfiguredBuiltinProviderId,
  generateCustomProviderId,
  getBuiltinProvider,
  type AnnotationAiProvider,
  type BuiltinAnnotationAiProviderId,
} from '../aiProviders';
import { ModelNameCombobox } from './ModelNameCombobox';

const CUSTOM_PROVIDER_KIND = 'custom';

type ProviderKind = BuiltinAnnotationAiProviderId | typeof CUSTOM_PROVIDER_KIND;

export interface AnnotationProviderCard {
  id: string;
  label: string;
  model: string;
  apiKey: string;
  builtinProviderId?: BuiltinAnnotationAiProviderId;
  customProvider?: AnnotationAiCustomProvider;
}

export interface AnnotationProviderConfigSave {
  id: string;
  apiKey: string;
  model: string;
  customProvider?: AnnotationAiCustomProvider;
}

interface AnnotationProviderConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AnnotationProviderCard | null;
  onSave: (config: AnnotationProviderConfigSave) => void;
}

function isProviderKind(value: string): value is ProviderKind {
  return (
    value === CUSTOM_PROVIDER_KIND ||
    ANNOTATION_AI_PROVIDERS.some((provider) => provider.id === value)
  );
}

function makeDraftCustomProvider(id: string, name: string, baseUrl: string): AnnotationAiProvider {
  return {
    id,
    requestProviderId: id,
    label: name.trim() || 'Custom provider',
    baseUrl: baseUrl.trim() || undefined,
    isCustom: true,
    requiresApiKey: false,
    supportsModelListing: baseUrl.trim().length > 0,
  };
}

/**
 * Form body for the configured-provider dialog.
 *
 * Used by: AnnotationProviderConfigDialog. Kept as a child component so Dialog
 * unmount/remount naturally re-seeds the local state for add vs edit without an
 * effect. Editing keeps the card id stable and locks the provider kind so saved
 * keys/models continue to address the same card.
 */
function AnnotationProviderConfigForm({
  provider,
  onSave,
  onCancel,
}: {
  provider: AnnotationProviderCard | null;
  onSave: (config: AnnotationProviderConfigSave) => void;
  onCancel: () => void;
}) {
  const isEdit = provider !== null;
  const initialKind: ProviderKind =
    provider?.customProvider !== undefined
      ? CUSTOM_PROVIDER_KIND
      : (provider?.builtinProviderId ?? DEFAULT_ANNOTATION_AI_PROVIDER_ID);
  const [providerKind, setProviderKind] = useState<ProviderKind>(initialKind);
  const [name, setName] = useState(provider?.customProvider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.customProvider?.base_url ?? '');
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '');
  const [model, setModel] = useState(provider?.model ?? '');

  const isCustom = providerKind === CUSTOM_PROVIDER_KIND;
  const trimmedName = name.trim();
  const trimmedBaseUrl = baseUrl.trim();
  const trimmedApiKey = apiKey.trim();
  const trimmedModel = model.trim();
  const builtinProviderId =
    providerKind === CUSTOM_PROVIDER_KIND ? DEFAULT_ANNOTATION_AI_PROVIDER_ID : providerKind;
  const draftProvider = isCustom
    ? makeDraftCustomProvider(provider?.id ?? 'custom:draft', trimmedName, trimmedBaseUrl)
    : getBuiltinProvider(builtinProviderId);
  const canSave =
    trimmedModel.length > 0 &&
    (isCustom ? trimmedName.length > 0 && trimmedBaseUrl.length > 0 : trimmedApiKey.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    const id =
      provider?.id ??
      (isCustom
        ? generateCustomProviderId()
        : generateConfiguredBuiltinProviderId(builtinProviderId));
    onSave({
      id,
      apiKey: trimmedApiKey,
      model: trimmedModel,
      ...(isCustom
        ? {
            customProvider: {
              id,
              name: trimmedName,
              base_url: trimmedBaseUrl,
            },
          }
        : {}),
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit provider' : 'Add provider'}</DialogTitle>
        <DialogDescription>
          Save a provider as its own card with the API key and model it should use.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="annotation-provider-kind">Provider</Label>
          <Select
            value={providerKind}
            disabled={isEdit}
            onValueChange={(next) => {
              if (!isProviderKind(next)) return;
              setProviderKind(next);
              setModel('');
            }}
          >
            <SelectTrigger id="annotation-provider-kind" aria-label="Provider type">
              <SelectValue placeholder="Choose a provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ANNOTATION_AI_PROVIDERS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_PROVIDER_KIND}>Custom base URL</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {isCustom ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="annotation-provider-name">Provider name</Label>
              <Input
                id="annotation-provider-name"
                value={name}
                placeholder="My provider"
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="annotation-provider-base-url">Base URL</Label>
              <Input
                id="annotation-provider-base-url"
                value={baseUrl}
                placeholder="https://your-endpoint.example.com/v1"
                autoComplete="off"
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                }}
              />
            </div>
          </>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="annotation-provider-api-key">
            API key
            {isCustom ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            ) : null}
          </Label>
          <Input
            id="annotation-provider-api-key"
            type="password"
            value={apiKey}
            placeholder={isCustom ? 'Optional for local endpoints' : 'Required'}
            autoComplete="off"
            onChange={(event) => {
              setApiKey(event.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="annotation-provider-model">Model</Label>
          <ModelNameCombobox
            id="annotation-provider-model"
            provider={draftProvider}
            apiKey={trimmedApiKey}
            value={model}
            onChange={setModel}
            onCommit={setModel}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSave} onClick={handleSave}>
          Save provider
        </Button>
      </DialogFooter>
    </>
  );
}

export function AnnotationProviderConfigDialog({
  open,
  onOpenChange,
  provider,
  onSave,
}: AnnotationProviderConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <AnnotationProviderConfigForm
          provider={provider}
          onSave={(config) => {
            onSave(config);
            onOpenChange(false);
          }}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
