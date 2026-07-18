import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clearProviderCredentials, getProviderCredentials, updateProviderCredentials } from '@/api';
import type { ProviderCredentialPatchWritable } from '@/api';

const CREDENTIALS_QUERY_KEY = ['provider-credentials'] as const;

export function DataPortalCredentialPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: CREDENTIALS_QUERY_KEY,
    queryFn: async () => (await getProviderCredentials({ throwOnError: true })).data,
  });
  const update = useMutation({
    mutationFn: (body: ProviderCredentialPatchWritable) =>
      updateProviderCredentials({ body, throwOnError: true }).then(({ data }) => data),
    onSuccess: (data) => {
      queryClient.setQueryData(CREDENTIALS_QUERY_KEY, data);
      toast.success('Data Portal credential updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not update credential');
    },
  });
  const clear = useMutation({
    mutationFn: () => clearProviderCredentials({ throwOnError: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CREDENTIALS_QUERY_KEY });
      toast.success('Data Portal credential cleared');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not clear credential');
    },
  });
  const [draft, setDraft] = useState('');
  const configured = query.data?.data_portal.user_configured ?? false;
  const deploymentConfigured = query.data?.data_portal.deployment_configured ?? false;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">LDaCA Data Portal credential</h3>
        <Badge variant={configured || deploymentConfigured ? 'outline' : 'secondary'}>
          {configured
            ? 'Configured for this user'
            : deploymentConfigured
              ? 'Deployment default'
              : 'Not configured'}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        The backend resolves this credential for portal search and imports. Existing values are
        never returned; enter a replacement to update it.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          value={draft}
          placeholder={configured ? 'Enter a replacement token' : 'Enter token'}
          autoComplete="off"
          aria-label="LDaCA Data Portal token"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button
          type="button"
          disabled={!draft.trim() || update.isPending}
          onClick={() => {
            void update.mutateAsync({ data_portal_api_token: draft.trim() });
            setDraft('');
          }}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!configured || clear.isPending}
          onClick={() => {
            clear.mutate();
          }}
        >
          Clear
        </Button>
      </div>
    </section>
  );
}
