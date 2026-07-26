/**
 * Filterable model-name field for the Annotation tab's AI settings.
 *
 * Rendered by: AnnotationAiSettings, once per active provider. It serves two
 * shapes from one control:
 *   1. Listable providers get a text input whose popover shows a live model list
 *      obtained through the backend provider adapter. The input always stays
 *      free-text, so users can still enter a model id by hand.
 *   2. Any provider without listing support falls back to a plain text input so
 *      users can still type any model id.
 *
 * Flow: the input value doubles as both the chosen model and a wildcard search
 * query. The model list is fetched lazily through React Query, keyed only by
 * safe provider metadata and a credential revision, so no secret enters query
 * state and no network call happens until the user opens the dropdown.
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { listAnnotationModelsWithProviderCredential } from '@/features/provider-credentials/providerCredentialRequests';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/queryKeys';
import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { canListModels } from '../aiProviders';

interface ModelDropdownOption {
  id: string;
}

interface ModelNameComboboxProps {
  configuration: AnnotationProviderConfigurationView;
  value: string;
  onChange: (value: string) => void;
  /**
   * Persist the current value. Fired on blur (free-typed model id) and on
   * picking a row, so the parent can write the model to durable tab state
   * without a backend round-trip per keystroke — the value doubles as the live
   * filter query, so committing on every change would be wasteful.
   */
  onCommit?: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function modelMatchesQuery(option: ModelDropdownOption, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(option.id);
  if (normalizedQuery.includes('*')) {
    const parts = normalizedQuery
      .split('*')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return true;
    return new RegExp(parts.map(escapeRegExp).join('.*')).test(haystack);
  }
  return normalizedQuery.split(' ').every((part) => haystack.includes(part));
}

export function ModelNameCombobox({
  configuration,
  value,
  onChange,
  onCommit,
  disabled,
  id,
}: ModelNameComboboxProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const listingEnabled = canListModels(configuration);
  const configurationId = configuration.id;
  const credentialRevision = configuration.credentialRevision;
  const provider = configuration.provider;
  const baseUrl = configuration.base_url ?? null;

  // The request facade injects browser-owned multi-user credentials only at the
  // network boundary. Single-user credentials remain backend-owned.
  const modelsQuery = useQuery<ModelDropdownOption[]>({
    queryKey: queryKeys.annotationModelList(configurationId, credentialRevision, provider, baseUrl),
    queryFn: async ({ signal }) => {
      const { data } = await listAnnotationModelsWithProviderCredential(
        { id: configurationId, provider, base_url: baseUrl },
        signal,
      );
      return data.models.map((modelId) => ({ id: modelId }));
    },
    enabled: open && listingEnabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const models = modelsQuery.data ?? [];
  // When the field already holds an exact catalogue entry, show the whole list
  // again on focus instead of filtering down to just that one row.
  const isExactModel = models.some((model) => model.id === value);
  const query = isExactModel ? '' : value;
  // Render every matching model (no cap): OpenRouter lists 300+, but the
  // popover is scrollable and wildcard search lets type-to-filter narrow the set.
  const filtered = query ? models.filter((model) => modelMatchesQuery(model, query)) : models;

  const openIfPossible = () => {
    if (!disabled && listingEnabled) setOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <Input
            id={id}
            value={value}
            disabled={disabled}
            placeholder={
              listingEnabled ? 'Search or type a model name' : 'Enter an API key to list models'
            }
            autoComplete="off"
            className="pr-8"
            onChange={(event) => {
              onChange(event.target.value);
              if (listingEnabled) setOpen(true);
            }}
            onBlur={(event) => {
              onCommit?.(event.target.value);
            }}
            onFocus={openIfPossible}
            onClick={openIfPossible}
          />
          <ChevronsUpDown
            className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50"
            aria-hidden="true"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        portalled={false}
        // Keep focus in the input so the user can keep typing while the list is
        // open, and don't yank focus back to the input on close.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        // Clicking/typing in the anchored input counts as "outside" the content;
        // suppress the auto-dismiss so interacting with the field keeps the list open.
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
      >
        <ScrollArea className="h-[min(16rem,var(--radix-popover-content-available-height))]">
          <div className="p-1">
            {modelsQuery.isLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading models…
              </div>
            ) : modelsQuery.isError ? (
              <div className="px-2 py-3 text-sm text-destructive">
                {configuration.provider === 'custom'
                  ? 'Could not list models; type a model name'
                  : modelsQuery.error instanceof Error
                    ? modelsQuery.error.message
                    : 'Failed to load models'}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">No matching models</div>
            ) : (
              filtered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={cn(
                    'relative flex w-full rounded-sm px-2 py-2 pr-8 text-left text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    model.id === value && 'bg-accent/50',
                  )}
                  onClick={() => {
                    onChange(model.id);
                    onCommit?.(model.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">{model.id}</span>
                  </span>
                  {model.id === value ? (
                    <Check className="absolute right-2 top-2 size-4 shrink-0" aria-hidden="true" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
