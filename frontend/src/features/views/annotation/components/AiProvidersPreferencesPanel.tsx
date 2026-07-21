import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProviderCredentials } from '@/features/provider-credentials/useProviderCredentials';
import { ANNOTATION_AI_PROVIDERS, type BuiltinAnnotationAiProviderId } from '../aiProviders';

type CredentialField = BuiltinAnnotationAiProviderId;

/**
 * Provider inputs remain blank/write-only. The credential facade routes a save
 * to the local backend in single-user mode or this browser in multi-user mode.
 */
export function AiProvidersPreferencesPanel() {
  const credentials = useProviderCredentials();
  const [pending, setPending] = useState<CredentialField | 'all' | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<CredentialField, string>>>({});

  const save = async (provider: BuiltinAnnotationAiProviderId) => {
    const value = drafts[provider]?.trim() ?? '';
    if (!value) return;
    setPending(provider);
    try {
      await credentials.saveAnnotationCredential(provider, value);
      setDrafts((current) => ({ ...current, [provider]: '' }));
      toast.success('Provider credential updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update credential');
    } finally {
      setPending(null);
    }
  };

  const clear = async (provider: BuiltinAnnotationAiProviderId) => {
    setPending(provider);
    try {
      await credentials.clearAnnotationCredential(provider);
      toast.success('Provider credential cleared');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear credential');
    } finally {
      setPending(null);
    }
  };

  const clearAll = async () => {
    setPending('all');
    try {
      await credentials.clearAnnotationCredentials();
      toast.success('Provider credentials cleared');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear credentials');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">AI provider credentials</h3>
          <p className="text-sm text-muted-foreground">
            {credentials.storage === 'browser'
              ? 'Credentials stay in this browser for the current account and are sent only with provider requests.'
              : 'Credentials are stored by the local backend and are never returned to the browser.'}{' '}
            Enter a new value to replace an existing credential.
          </p>
        </div>
        <div className="space-y-2">
          {ANNOTATION_AI_PROVIDERS.map((provider) => {
            const field = provider.id;
            const configured = credentials.annotation[field];
            return (
              <div
                key={provider.id}
                className="space-y-2 rounded-md border border-border/70 px-3 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{provider.label}</p>
                  <Badge variant={configured ? 'outline' : 'secondary'}>
                    {configured ? 'Configured' : 'Not configured'}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={drafts[field] ?? ''}
                    placeholder={configured ? 'Enter a replacement credential' : 'Enter credential'}
                    autoComplete="off"
                    aria-label={`${provider.label} API key`}
                    onChange={(event) => {
                      setDrafts((current) => ({ ...current, [field]: event.target.value }));
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      void save(provider.id);
                    }}
                    disabled={!drafts[field]?.trim() || pending !== null}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void clear(provider.id);
                    }}
                    disabled={!configured || pending !== null}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void clearAll();
        }}
        disabled={pending !== null || !Object.values(credentials.annotation).some(Boolean)}
      >
        Clear all AI provider credentials
      </Button>
    </div>
  );
}
