import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clearProviderCredentials, getProviderCredentials, updateProviderCredentials } from '@/api';
import type { AnnotationCredentialStatus, ProviderCredentialPatchWritable } from '@/api';
import { ANNOTATION_AI_PROVIDERS, type BuiltinAnnotationAiProviderId } from '../aiProviders';

const CREDENTIALS_QUERY_KEY = ['provider-credentials'] as const;

type CredentialField = keyof AnnotationCredentialStatus;

const FIELD_BY_PROVIDER: Record<CredentialField, keyof ProviderCredentialPatchWritable> = {
  openai: 'openai_api_key',
  openrouter: 'openrouter_api_key',
  anthropic: 'anthropic_api_key',
  google: 'google_api_key',
};

/**
 * Hosted credentials are write-only. The form therefore keeps the entered
 * value only in the input element and renders the server's presence booleans.
 * No secret is copied into Zustand, localStorage, tab settings, or query data.
 */
export function AiProvidersPreferencesPanel() {
  const queryClient = useQueryClient();
  const credentialsQuery = useQuery({
    queryKey: CREDENTIALS_QUERY_KEY,
    queryFn: async () => (await getProviderCredentials({ throwOnError: true })).data,
  });
  const updateMutation = useMutation({
    mutationFn: (body: ProviderCredentialPatchWritable) =>
      updateProviderCredentials({ body, throwOnError: true }).then(({ data }) => data),
    onSuccess: (data) => {
      queryClient.setQueryData(CREDENTIALS_QUERY_KEY, data);
      toast.success('Provider credential updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not update credential');
    },
  });
  const clearMutation = useMutation({
    mutationFn: () => clearProviderCredentials({ throwOnError: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CREDENTIALS_QUERY_KEY });
      toast.success('Provider credentials cleared');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not clear credentials');
    },
  });

  const statuses = credentialsQuery.data?.annotation;
  const [drafts, setDrafts] = useState<Partial<Record<CredentialField, string>>>({});

  const save = (provider: BuiltinAnnotationAiProviderId) => {
    const field = FIELD_BY_PROVIDER[provider];
    const value = drafts[provider]?.trim() ?? '';
    if (!value) return;
    void updateMutation.mutateAsync({ [field]: value });
    setDrafts((current) => ({ ...current, [provider]: '' }));
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">AI provider credentials</h3>
          <p className="text-sm text-muted-foreground">
            Credentials are stored by the backend and are never returned to the browser. Enter a new
            value to replace an existing credential.
          </p>
        </div>
        <div className="space-y-2">
          {ANNOTATION_AI_PROVIDERS.map((provider) => {
            const field = provider.id;
            const configured = statuses?.[field] ?? false;
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
                      save(provider.id);
                    }}
                    disabled={!drafts[field]?.trim() || updateMutation.isPending}
                  >
                    Save
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
          clearMutation.mutate();
        }}
        disabled={clearMutation.isPending || !credentialsQuery.data}
      >
        Clear all provider credentials
      </Button>
    </div>
  );
}
