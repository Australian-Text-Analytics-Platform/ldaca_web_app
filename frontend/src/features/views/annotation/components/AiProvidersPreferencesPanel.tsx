import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { useProviderCredentials } from '@/features/provider-credentials/useProviderCredentials';
import { providerConfigurationSecondaryText } from '../aiProviders';
import { AddAnnotationProviderDialog } from './AddAnnotationProviderDialog';

/** Ordered management UI for named Annotation provider configurations. */
export function AiProvidersPreferencesPanel() {
  const credentials = useProviderCredentials();
  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AnnotationProviderConfigurationView | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AnnotationProviderConfigurationView | null>(
    null,
  );
  const [clearOpen, setClearOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const rename = async () => {
    if (!renameTarget || !renameDraft.trim()) return;
    setPending(true);
    try {
      await credentials.renameAnnotationProvider(renameTarget.id, renameDraft);
      setRenameTarget(null);
      toast.success('Provider renamed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename provider');
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setPending(true);
    try {
      await credentials.deleteAnnotationProvider(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('Provider deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete provider');
    } finally {
      setPending(false);
    }
  };

  const clearAll = async () => {
    setPending(true);
    try {
      await credentials.clearAnnotationProviders();
      setClearOpen(false);
      toast.success('Annotation providers cleared');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear providers');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Annotation providers</h3>
          <p className="text-sm text-muted-foreground">
            {credentials.storage === 'browser'
              ? 'Configurations stay in this browser for the current account. Secrets are sent only with provider requests.'
              : 'Configurations are stored by the local backend. Saved secrets are never returned to the browser.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            To change a provider type, URL, or API key, add a new configuration and then delete the
            old one.
          </p>
        </div>

        {credentials.annotationProviders.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            No Annotation providers configured.
          </p>
        ) : (
          <div className="space-y-2">
            {credentials.annotationProviders.map((configuration) => (
              <div key={configuration.id} className="rounded-md border border-border/70 px-3 py-3">
                {renameTarget?.id === configuration.id ? (
                  <div className="flex gap-2">
                    <Input
                      aria-label={`Rename ${configuration.name}`}
                      value={renameDraft}
                      disabled={pending}
                      onChange={(event) => {
                        setRenameDraft(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void rename();
                        if (event.key === 'Escape') setRenameTarget(null);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || !renameDraft.trim()}
                      onClick={() => {
                        void rename();
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setRenameTarget(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{configuration.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {providerConfigurationSecondaryText(configuration)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">
                        {configuration.has_api_key ? 'Key saved' : 'No key'}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setRenameTarget(configuration);
                          setRenameDraft(configuration.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setDeleteTarget(configuration);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            setAddOpen(true);
          }}
          disabled={pending}
        >
          Add Provider
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setClearOpen(true);
          }}
          disabled={pending || credentials.annotationProviders.length === 0}
        >
          Clear all providers
        </Button>
      </div>

      <AddAnnotationProviderDialog open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete provider?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {deleteTarget?.name ?? 'this provider configuration'}? Historical Results
              remain readable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all providers?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete every configured Annotation provider. Historical Results remain readable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void clearAll();
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
