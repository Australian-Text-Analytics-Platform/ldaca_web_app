/**
 * Dialog for registering or editing a user-defined custom AI provider.
 *
 * Rendered by:
 * - AnnotationAiSettings, opened when the user picks the "Custom…" entry in the
 *   provider dropdown (add mode only).
 * - AiProvidersPreferencesPanel (Settings → AI), for both adding a new provider
 *   and editing an existing one via its row "Edit" button.
 *
 * It collects a display name + an OpenAI-compatible base URL and, on Save, hands
 * a fully-formed `AnnotationAiCustomProvider` back to the parent, which persists
 * it to preferences. In add mode a fresh `custom:<uuid>` id is generated; in edit
 * mode the existing provider's id is reused so the store replaces it in place.
 *
 * Controlled open state: the parent owns `open`/`onOpenChange` because there is
 * no built-in trigger button. The form body is a child component rendered inside
 * `DialogContent`, which Radix unmounts while the dialog is closed, so the form's
 * `useState` initializers re-seed from the current `provider` on every open
 * (blank when adding) without an effect.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AnnotationAiCustomProvider } from '@/api';
import { generateCustomProviderId } from '../aiProviders';

interface CustomProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the provider when the user saves; parent persists it. */
  onSave: (provider: AnnotationAiCustomProvider) => void;
  /**
   * When set, the dialog edits this provider: it pre-fills the inputs and keeps
   * the provider's id on save. When null/undefined, the dialog adds a new
   * provider with a freshly generated id.
   */
  provider?: AnnotationAiCustomProvider | null;
}

interface CustomProviderFormProps {
  provider: AnnotationAiCustomProvider | null;
  onSave: (provider: AnnotationAiCustomProvider) => void;
  onCancel: () => void;
}

/**
 * The name + base URL form body. Lives in its own component so its `useState`
 * initializers seed straight from `provider` on mount: because the parent
 * renders it inside `DialogContent` (which Radix unmounts when the dialog is
 * closed), it re-mounts on every open and therefore always reflects the current
 * add/edit target without an effect re-syncing state. Rendered by:
 * CustomProviderDialog.
 */
function CustomProviderForm({ provider, onSave, onCancel }: CustomProviderFormProps) {
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '');

  const trimmedName = name.trim();
  const trimmedBaseUrl = baseUrl.trim();
  const canSave = trimmedName.length > 0 && trimmedBaseUrl.length > 0;
  const isEdit = provider !== null;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: provider?.id ?? generateCustomProviderId(),
      name: trimmedName,
      base_url: trimmedBaseUrl,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit custom provider' : 'Add custom provider'}</DialogTitle>
        <DialogDescription>
          Register an OpenAI-compatible endpoint. It is saved to your preferences and appears in the
          provider list.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="custom-provider-name">Name</Label>
          <Input
            id="custom-provider-name"
            value={name}
            placeholder="My provider"
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-provider-base-url">Base URL</Label>
          <Input
            id="custom-provider-base-url"
            value={baseUrl}
            placeholder="https://your-endpoint.example.com/v1"
            autoComplete="off"
            onChange={(event) => {
              setBaseUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSave) handleSave();
            }}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSave} onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

export function CustomProviderDialog({
  open,
  onOpenChange,
  onSave,
  provider = null,
}: CustomProviderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <CustomProviderForm
          provider={provider}
          onSave={(saved) => {
            onSave(saved);
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

export default CustomProviderDialog;
