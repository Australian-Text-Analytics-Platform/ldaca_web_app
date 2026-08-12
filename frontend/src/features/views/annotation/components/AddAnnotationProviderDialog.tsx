import { useState } from 'react';

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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { useProviderCredentials } from '@/features/provider-credentials/useProviderCredentials';
import { acceptPlaceholderOnTab } from '@/features/views/common/placeholderTabFill';
import {
  ANNOTATION_PROVIDER_DEFINITIONS,
  getProviderDefinition,
  type AnnotationProviderType,
} from '../aiProviders';

interface AddAnnotationProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (configuration: AnnotationProviderConfigurationView) => void;
}

const DEFAULT_PROVIDER: AnnotationProviderType = 'openrouter';

/** Shared add flow used by Annotation and Settings without exposing saved secrets. */
export function AddAnnotationProviderDialog({
  open,
  onOpenChange,
  onCreated,
}: AddAnnotationProviderDialogProps) {
  const credentials = useProviderCredentials();
  const [provider, setProvider] = useState<AnnotationProviderType>(DEFAULT_PROVIDER);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const definition = getProviderDefinition(provider);

  const reset = () => {
    setProvider(DEFAULT_PROVIDER);
    setName('');
    setBaseUrl('');
    setApiKey('');
    setError(null);
    setPending(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const addProvider = async () => {
    const resolvedName = name.trim() || definition.label;
    if (provider === 'custom' && !baseUrl.trim()) {
      setError('Enter a Custom Base URL');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const configuration = await credentials.addAnnotationProvider({
        name: resolvedName,
        provider,
        baseUrl: provider === 'custom' ? baseUrl : null,
        apiKey,
      });
      onCreated?.(configuration);
      handleOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add provider');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>
            Add a named provider configuration for Annotation. Saved credentials are write-only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="annotation-provider-type">Provider</Label>
            <Select
              value={provider}
              disabled={pending}
              onValueChange={(value) => {
                setProvider(value as AnnotationProviderType);
                setError(null);
              }}
            >
              <SelectTrigger id="annotation-provider-type" aria-label="Provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANNOTATION_PROVIDER_DEFINITIONS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {provider === 'custom' ? (
            <div className="space-y-1.5">
              <Label htmlFor="annotation-provider-base-url">Custom Base URL</Label>
              <Input
                id="annotation-provider-base-url"
                value={baseUrl}
                disabled={pending}
                placeholder="http://localhost:8080/v1"
                autoComplete="url"
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setError(null);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Must implement OpenAI&apos;s Chat Completions API.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="annotation-provider-api-key">
              API Key
              <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="annotation-provider-api-key"
              type="password"
              value={apiKey}
              disabled={pending}
              autoComplete="off"
              onChange={(event) => {
                setApiKey(event.target.value);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {definition.requiresApiKey
                ? 'You can save this provider now, but an API key is required before use.'
                : 'Leave blank when the Custom endpoint does not require authentication.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="annotation-provider-name">Name</Label>
            <Input
              id="annotation-provider-name"
              value={name}
              disabled={pending}
              placeholder={definition.label}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                acceptPlaceholderOnTab({ event, value: name, setValue: setName });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Press Tab to accept the gray suggestion, or start typing your own name.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              handleOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              void addProvider();
            }}
          >
            {pending ? 'Adding…' : 'Add Provider'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
