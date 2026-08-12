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
import type {
  AnnotationProviderConfigurationUpdateInput,
  AnnotationProviderConfigurationView,
} from '@/features/provider-credentials/providerCredentialsStore';
import { getProviderDefinition } from '../aiProviders';

interface EditAnnotationProviderDialogProps {
  configuration: AnnotationProviderConfigurationView | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    configurationId: string,
    input: AnnotationProviderConfigurationUpdateInput,
  ) => Promise<void>;
}

/** Edit only the mutable name and credential of one stable provider slot. */
export function EditAnnotationProviderDialog({
  configuration,
  pending,
  onOpenChange,
  onSave,
}: EditAnnotationProviderDialogProps) {
  const [draftState, setDraftState] = useState<{
    configurationId: string | null;
    name: string;
    apiKey: string;
    removeKey: boolean;
    error: string | null;
  }>({ configurationId: null, name: '', apiKey: '', removeKey: false, error: null });
  const draft =
    configuration?.id === draftState.configurationId
      ? draftState
      : {
          configurationId: configuration?.id ?? null,
          name: configuration?.name ?? '',
          apiKey: '',
          removeKey: false,
          error: null,
        };
  const trimmedName = draft.name.trim();
  const trimmedApiKey = draft.apiKey.trim();
  const nameChanged = Boolean(configuration && trimmedName !== configuration.name);
  const credentialChanged = draft.removeKey || trimmedApiKey.length > 0;
  const canSave = Boolean(trimmedName && (nameChanged || credentialChanged));

  const updateDraft = (patch: Partial<typeof draft>) => {
    setDraftState({ ...draft, ...patch, configurationId: configuration?.id ?? null });
  };

  const save = async () => {
    if (!configuration || !canSave) return;
    const input: AnnotationProviderConfigurationUpdateInput = {
      ...(nameChanged ? { name: trimmedName } : {}),
      ...(draft.removeKey ? { apiKey: null } : trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
    };
    try {
      await onSave(configuration.id, input);
      onOpenChange(false);
    } catch (error) {
      updateDraft({ error: error instanceof Error ? error.message : 'Could not update provider' });
    }
  };

  return (
    <Dialog
      open={configuration !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Provider</DialogTitle>
          <DialogDescription>
            Update the display name or saved credential. Provider identity and endpoint stay fixed.
          </DialogDescription>
        </DialogHeader>

        {configuration ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Provider</p>
                <p className="font-medium">{getProviderDefinition(configuration.provider).label}</p>
              </div>
              {configuration.provider === 'custom' ? (
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Base URL</p>
                  <p className="truncate font-medium" title={configuration.base_url ?? undefined}>
                    {configuration.base_url}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-annotation-provider-name">Name</Label>
              <Input
                id="edit-annotation-provider-name"
                value={draft.name}
                disabled={pending}
                onChange={(event) => {
                  updateDraft({ name: event.target.value, error: null });
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-annotation-provider-api-key">New API Key</Label>
              <Input
                id="edit-annotation-provider-api-key"
                type="password"
                value={draft.apiKey}
                disabled={pending || draft.removeKey}
                autoComplete="off"
                placeholder="Leave blank to keep the saved key"
                onChange={(event) => {
                  updateDraft({ apiKey: event.target.value, removeKey: false, error: null });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Saved keys are write-only and cannot be displayed here.
              </p>
            </div>

            {configuration.has_api_key ? (
              <Button
                type="button"
                variant={draft.removeKey ? 'destructive' : 'outline'}
                disabled={pending}
                onClick={() => {
                  updateDraft({ removeKey: !draft.removeKey, apiKey: '', error: null });
                }}
              >
                {draft.removeKey ? 'Keep saved key' : 'Remove saved key'}
              </Button>
            ) : null}

            {draft.removeKey ? (
              <p className="text-sm text-destructive">The saved API key will be removed.</p>
            ) : null}
            {draft.error ? (
              <p role="alert" className="text-sm text-destructive">
                {draft.error}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending || !canSave} onClick={() => void save()}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
