/**
 * Filterable model-name field for the Annotation tab's AI settings.
 *
 * Rendered by: AnnotationAiSettings, once per active provider. It serves two
 * shapes from one control:
 *   1. Providers the backend can list (OpenRouter, OpenAI, Anthropic, Google, and
 *      custom OpenAI-compatible endpoints that expose `/models`) get a text input
 *      whose popover shows the live model list — fetched from our
 *      `/annotation/ai/models` endpoint (the backend calls the provider's native
 *      SDK) — filtered as the user types; clicking a row fills the field. The
 *      input always stays free-text, so a custom endpoint that lacks `/models`
 *      just shows a dropdown error while the user types an id by hand.
 *   2. Any provider without listing support falls back to a plain text input so
 *      users can still type any model id.
 *
 * Flow: the input value doubles as both the chosen model and the filter query.
 * The model list is fetched lazily through React Query (keyed by provider + base
 * URL + key) only while the popover is open and the provider's key requirement is
 * met, so no backend call happens until the user actually opens the dropdown.
 * Auth is injected by the shared generated client, so no header threading here.
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { listAnnotationAiModels } from '@/api';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type AnnotationAiProvider, canListModels } from '../aiProviders';

interface ModelNameComboboxProps {
  provider: AnnotationAiProvider;
  apiKey: string;
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

export function ModelNameCombobox({
  provider,
  apiKey,
  value,
  onChange,
  onCommit,
  disabled,
  id,
}: ModelNameComboboxProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const listingEnabled = canListModels(provider, apiKey);

  // Lazy, cached fetch through the backend (`/annotation/ai/models`): only runs
  // while the popover is open and the provider's key requirement is satisfied.
  // Keyed by provider + base URL + key so switching any refetches; retry is off
  // so an auth error surfaces immediately. The browser never calls the provider
  // directly — the backend uses the provider's native SDK and returns model ids.
  const modelsQuery = useQuery({
    queryKey: ['annotation-ai-models', provider.id, provider.baseUrl ?? '', apiKey],
    queryFn: async () => {
      const { data } = await listAnnotationAiModels({
        body: {
          provider_id: provider.id,
          base_url: provider.baseUrl ?? null,
          api_key: apiKey.trim(),
        },
        throwOnError: true,
      });
      return data.models ?? [];
    },
    enabled: open && listingEnabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Custom (no backend listing support): plain text input, no dropdown.
  if (!provider.supportsModelListing) {
    return (
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder="Model name"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={(event) => {
          onCommit?.(event.target.value);
        }}
      />
    );
  }

  const models = modelsQuery.data ?? [];
  // When the field already holds an exact catalogue entry, show the whole list
  // again on focus instead of filtering down to just that one row.
  const isExactModel = models.includes(value);
  const query = isExactModel ? '' : value.trim().toLowerCase();
  // Render every matching model (no cap): OpenRouter lists 300+, but the
  // popover is scrollable and the provider API exposes no popularity ranking,
  // so we list them all and let type-to-filter narrow the set.
  const filtered = query
    ? models.filter((model) => model.toLowerCase().includes(query))
    : models;

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
        <ScrollArea className="max-h-64">
          <div className="p-1">
            {modelsQuery.isLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading models…
              </div>
            ) : modelsQuery.isError ? (
              <div className="px-2 py-3 text-sm text-destructive">
                {modelsQuery.error instanceof Error
                  ? modelsQuery.error.message
                  : 'Failed to load models'}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">No matching models</div>
            ) : (
              filtered.map((model) => (
                <button
                  key={model}
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    model === value && 'bg-accent/50',
                  )}
                  onClick={() => {
                    onChange(model);
                    onCommit?.(model);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{model}</span>
                  {model === value ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export default ModelNameCombobox;
