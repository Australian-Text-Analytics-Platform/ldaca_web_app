import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProviderCredentials } from '@/features/provider-credentials/useProviderCredentials';

export function DataPortalCredentialPanel() {
  const credentials = useProviderCredentials();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const configured = credentials.dataPortal.userConfigured;
  const deploymentConfigured = credentials.dataPortal.deploymentConfigured;

  const save = async () => {
    if (!draft.trim()) return;
    setPending(true);
    try {
      await credentials.saveDataPortalCredential(draft);
      setDraft('');
      toast.success('Data Portal credential updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update credential');
    } finally {
      setPending(false);
    }
  };

  const clear = async () => {
    setPending(true);
    try {
      await credentials.clearDataPortalCredential();
      toast.success('Data Portal credential cleared');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear credential');
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-body font-semibold">LDaCA Data Portal credential</h3>
        <Badge variant={configured || deploymentConfigured ? 'outline' : 'secondary'}>
          {configured
            ? credentials.storage === 'browser'
              ? 'Configured in this browser'
              : 'Configured for this user'
            : deploymentConfigured
              ? 'Deployment default'
              : 'Not configured'}
        </Badge>
      </div>
      <p className="text-body text-description">
        {credentials.storage === 'browser'
          ? 'This token stays in this browser for the current account and is sent only with Data Portal requests.'
          : 'The local backend stores this write-only token for Data Portal search and imports.'}{' '}
        Enter a new value to replace it.
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
          disabled={!draft.trim() || pending}
          onClick={() => {
            void save();
          }}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!configured || pending}
          onClick={() => {
            void clear();
          }}
        >
          Clear
        </Button>
      </div>
    </section>
  );
}
