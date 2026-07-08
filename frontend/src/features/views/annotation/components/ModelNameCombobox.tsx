/**
 * Filterable model-name field for the Annotation tab's AI settings.
 *
 * Rendered by: AnnotationAiSettings, once per active provider. It serves two
 * shapes from one control:
 *   1. Listable providers get a text input whose popover shows a live model list:
 *      OpenRouter is fetched directly from its public client-side `GET /models`
 *      endpoint so pricing can be displayed, while OpenAI/Anthropic/Google/custom
 *      providers continue through our `/annotation/ai/models` backend proxy. The
 *      input always stays free-text, so a custom endpoint that lacks `/models`
 *      just shows a dropdown error while the user types an id by hand.
 *   2. Any provider without listing support falls back to a plain text input so
 *      users can still type any model id.
 *
 * Flow: the input value doubles as both the chosen model and a wildcard search
 * query. The model list is fetched lazily through React Query (keyed by provider
 * card + provider + base URL + relevant key) only while the popover is open and
 * the provider's key requirement is met, so no network call happens until the
 * user opens the dropdown. Backend-listed providers use generated client auth;
 * OpenRouter intentionally bypasses the backend per the client-side pricing UI.
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

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

interface ModelDropdownOption {
  id: string;
  name?: string;
  priceLabel?: string;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function formatUsdPerMillionTokens(rawPrice: string | undefined): string | undefined {
  if (rawPrice === undefined) return undefined;
  const perToken = Number(rawPrice);
  if (!Number.isFinite(perToken)) return undefined;
  const perMillion = perToken * 1_000_000;
  if (perMillion === 0) return '$0';
  const maximumFractionDigits = perMillion < 0.01 ? 4 : perMillion < 1 ? 3 : 2;
  return `$${perMillion.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  })}`;
}

function formatOpenRouterPrice(pricing: Record<string, unknown> | undefined): string | undefined {
  if (!pricing) return undefined;
  const prompt = formatUsdPerMillionTokens(readString(pricing, 'prompt'));
  const completion = formatUsdPerMillionTokens(readString(pricing, 'completion'));
  if (!prompt && !completion) return undefined;
  if ((prompt ?? '$0') === '$0' && (completion ?? '$0') === '$0') return 'Free';
  return `In ${prompt ?? 'n/a'} / Out ${completion ?? 'n/a'} per 1M`;
}

function parseOpenRouterModelsPayload(payload: unknown): ModelDropdownOption[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const modelId = readString(entry, 'id');
    if (!modelId) return [];
    const modelName = readString(entry, 'name');
    const pricing = entry.pricing;
    const priceLabel = isRecord(pricing) ? formatOpenRouterPrice(pricing) : undefined;
    return [
      {
        id: modelId,
        ...(modelName && modelName !== modelId ? { name: modelName } : {}),
        ...(priceLabel ? { priceLabel } : {}),
      },
    ];
  });
}

async function fetchOpenRouterModels(): Promise<ModelDropdownOption[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    throw new Error(`Failed to load OpenRouter models: ${String(response.status)}${statusText}`);
  }
  return parseOpenRouterModelsPayload(await response.json());
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
  const haystack = normalizeSearchText([option.id, option.name, option.priceLabel].join(' '));
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
  const listsOpenRouterDirectly = provider.requestProviderId === 'openrouter';
  const listingCredentialKey = listsOpenRouterDirectly ? '' : apiKey;

  // Lazy, cached model listing: OpenRouter is intentionally fetched directly so
  // the UI can use its public pricing payload, while other providers still route
  // through the backend proxy that owns native SDK calls and provider secrets.
  const modelsQuery = useQuery<ModelDropdownOption[]>({
    queryKey: [
      'annotation-ai-models',
      provider.id,
      provider.requestProviderId,
      provider.baseUrl ?? '',
      listingCredentialKey,
    ],
    queryFn: async () => {
      if (listsOpenRouterDirectly) return fetchOpenRouterModels();
      const { data } = await listAnnotationAiModels({
        body: {
          provider_id: provider.requestProviderId,
          base_url: provider.baseUrl ?? null,
          api_key: apiKey.trim(),
        },
        throwOnError: true,
      });
      return (data.models ?? []).map((modelId) => ({ id: modelId }));
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
                {modelsQuery.error instanceof Error
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
                    {model.name ? (
                      <span className="truncate text-xs text-muted-foreground">{model.name}</span>
                    ) : null}
                    {model.priceLabel ? (
                      <span className="truncate text-xs leading-tight text-muted-foreground tabular-nums">
                        {model.priceLabel}
                      </span>
                    ) : null}
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
