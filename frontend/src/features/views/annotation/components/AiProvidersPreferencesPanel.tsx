/**
 * Settings → AI panel for managing Annotation AI providers and their API keys.
 *
 * Rendered by: SettingsDialog (the "AI" vertical tab). It is the central place to
 * manage credentials that the Annotation tab's AI mode consumes, so users don't
 * have to open the Annotation view to set them up.
 *
 * It lists every selectable provider:
 * - the built-in catalogue (`ANNOTATION_AI_PROVIDERS`: OpenRouter/OpenAI/
 *   Anthropic/Google), each with a save-on-blur API key field; OpenRouter's key
 *   is optional, the rest are required to use the provider.
 * - user-defined custom providers (from `annotationAiCustomProviders` in the
 *   preferences store), each additionally offering Edit (name + base URL) and
 *   Delete.
 *
 * All edits go through the preferences store setters, which the debounced backend
 * sync (`usePreferences`) persists to the TOML preferences file. Deleting a custom
 * provider also drops its stored key (handled by the store action).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import type { AnnotationAiCustomProvider } from '@/api';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { ANNOTATION_AI_PROVIDERS } from '../aiProviders';
import { CustomProviderDialog } from './CustomProviderDialog';

interface ProviderKeyFieldProps {
  providerId: string;
  /** Provider label, used for the input's accessible name. */
  label: string;
  optional: boolean;
  apiKey: string;
  onCommit: (key: string) => void;
}

/**
 * Uncontrolled, save-on-blur API key field for one provider.
 *
 * Why uncontrolled: re-rendering a controlled password input on every keystroke
 * is unnecessary, and the committed value lives in the preferences store. The
 * composite React `key` (`...-${apiKey}`) re-seeds the field whenever the stored
 * key changes (hydration, commit, or delete) while staying stable during typing.
 * Used by: the provider rows in AiProvidersPreferencesPanel.
 */
function ProviderKeyField({ providerId, label, optional, apiKey, onCommit }: ProviderKeyFieldProps) {
  return (
    <Input
      key={`pref-ai-key-${providerId}-${apiKey}`}
      type="password"
      defaultValue={apiKey}
      placeholder={optional ? 'API key (optional)' : 'API key'}
      autoComplete="off"
      aria-label={`${label} API key`}
      onBlur={(event) => {
        onCommit(event.target.value);
      }}
    />
  );
}

/**
 * Manage Annotation AI providers + API keys from the Settings dialog.
 * Used by: SettingsDialog's "AI" tab.
 */
export function AiProvidersPreferencesPanel() {
  const apiKeys = usePreferencesStore((state) => state.annotationAiApiKeys);
  const customProviders = usePreferencesStore((state) => state.annotationAiCustomProviders);
  const setApiKey = usePreferencesStore((state) => state.setAnnotationAiApiKey);
  const addCustomProvider = usePreferencesStore((state) => state.addAnnotationAiCustomProvider);
  const removeCustomProvider = usePreferencesStore(
    (state) => state.removeAnnotationAiCustomProvider,
  );

  // Single dialog instance reused for both add (provider null) and edit.
  const [dialog, setDialog] = useState<{
    open: boolean;
    provider: AnnotationAiCustomProvider | null;
  }>({ open: false, provider: null });
  const [pendingDelete, setPendingDelete] = useState<AnnotationAiCustomProvider | null>(null);

  /** Called by: the dialog's onSave for both add and edit; add/replace by id, then toast. */
  const handleSaveProvider = (provider: AnnotationAiCustomProvider) => {
    const isEdit = customProviders.some((p) => p.id === provider.id);
    addCustomProvider(provider);
    setDialog({ open: false, provider: null });
    toast.success(isEdit ? `Updated ${provider.name}` : `Added ${provider.name}`);
  };

  /** Called by: the delete confirmation dialog after the user confirms removal. */
  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    removeCustomProvider(pendingDelete.id);
    toast.success(`Removed ${pendingDelete.name}`);
    setPendingDelete(null);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">AI Providers</h3>
          <p className="text-sm text-muted-foreground">
            API keys are saved to your preferences and used by the Annotation tab's AI mode.
            Keys are stored in your local preferences file.
          </p>
        </div>
        <div className="space-y-2">
          {ANNOTATION_AI_PROVIDERS.map((provider) => {
            const apiKey = apiKeys[provider.id] ?? '';
            return (
              <div
                key={provider.id}
                className="space-y-2 rounded-md border border-border/70 px-3 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{provider.label}</p>
                  <Badge variant={apiKey ? 'outline' : 'secondary'}>
                    {apiKey ? 'Key set' : provider.requiresApiKey ? 'No key' : 'Optional'}
                  </Badge>
                </div>
                <ProviderKeyField
                  providerId={provider.id}
                  label={provider.label}
                  optional={!provider.requiresApiKey}
                  apiKey={apiKey}
                  onCommit={(key) => {
                    setApiKey(provider.id, key);
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3 border-t border-border/60 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Custom Providers</h3>
            <p className="text-sm text-muted-foreground">
              OpenAI-compatible endpoints you register yourself.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDialog({ open: true, provider: null });
            }}
          >
            <Plus className="h-4 w-4" />
            Add provider
          </Button>
        </div>

        {customProviders.length ? (
          <div className="space-y-2">
            {customProviders.map((provider) => {
              const apiKey = apiKeys[provider.id] ?? '';
              return (
                <div
                  key={provider.id}
                  className="space-y-2 rounded-md border border-border/70 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{provider.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{provider.base_url}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${provider.name}`}
                        onClick={() => {
                          setDialog({ open: true, provider });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${provider.name}`}
                        onClick={() => {
                          setPendingDelete(provider);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <ProviderKeyField
                    providerId={provider.id}
                    label={provider.name}
                    optional
                    apiKey={apiKey}
                    onCommit={(key) => {
                      setApiKey(provider.id, key);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No custom providers yet.</p>
        )}
      </section>

      <CustomProviderDialog
        open={dialog.open}
        provider={dialog.provider}
        onOpenChange={(open) => {
          setDialog((prev) => ({ open, provider: open ? prev.provider : null }));
        }}
        onSave={handleSaveProvider}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete custom provider?"
        description={
          pendingDelete
            ? `${pendingDelete.name} and its saved API key will be removed.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        variant="destructive"
      />
    </div>
  );
}
