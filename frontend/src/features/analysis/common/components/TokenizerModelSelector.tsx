import { useQuery } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { getNodeData, getTokenizerModels } from '@/api/generated/sdk.gen';
import { queryKeys } from '@/lib/queryKeys';
import { detectLanguageIso6391 } from '@/lib/languageDetection';
import { partitionTokenizerModelsForLanguage } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { collectDocumentColumnText } from './tokenizerModelSelectorUtils';

const TOKENIZER_MODELS_LOADING_VALUE = '__ldaca__tokenizer_models_loading__';
const TOKENIZER_MODELS_ERROR_VALUE = '__ldaca__tokenizer_models_error__';
const TOKENIZER_MODELS_EMPTY_VALUE = '__ldaca__tokenizer_models_empty__';
const TOKENIZER_MODEL_CLEAR_VALUE = '__ldaca__select_tokenizer_model__';
const LANGUAGE_SAMPLE_PAGE_SIZE = 100;

export interface TokenizerModelSelectorProps {
  workspaceId: string | null;
  nodeId: string;
  column: string;
  value?: string;
  onChange: (value: string, detectedLanguage: string | null) => void;
  getAuthHeaders: () => Record<string, string>;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

/**
 * Lets token-based analysis panels choose a tokenizer model for the selected
 * source column, using sampled text to group backend models by detected language.
 * Used by: concordance and token-frequency parameter panels because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function TokenizerModelSelector({
  workspaceId,
  nodeId,
  column,
  value,
  onChange,
  getAuthHeaders,
  disabled = false,
  disabledReason,
  className,
}: TokenizerModelSelectorProps) {
  const canFetchSample = Boolean(workspaceId && nodeId && column);
  const sampleQuery = useQuery({
    queryKey: workspaceId
      ? [...queryKeys.nodeData(workspaceId, nodeId, 1, LANGUAGE_SAMPLE_PAGE_SIZE), 'language-sample', column]
      : ['tokenizer-language-sample', nodeId, column],
    enabled: canFetchSample,
    staleTime: 60_000,
    /** Called by: TanStack Query to fetch sample text for language detection because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    queryFn: async () => {
      const { data } = await getNodeData({
        path: { node_id: nodeId },
        query: { page: 1, page_size: LANGUAGE_SAMPLE_PAGE_SIZE },
        headers: getAuthHeaders(),
        throwOnError: true,
      });
      return data;
    },
  });

  const sampleText = collectDocumentColumnText(
    sampleQuery.data?.data as Array<Record<string, unknown>> | undefined,
    column,
  );

  const detectionQuery = useQuery({
    queryKey: ['tokenizer-language-detection', workspaceId, nodeId, column, sampleText.slice(0, 512)],
    enabled: sampleText.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    /** Called by: TanStack Query after sample text is available because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    queryFn: () => detectLanguageIso6391(sampleText),
  });

  const detectedLanguage = detectionQuery.data ?? null;
  const modelQuery = useQuery({
    queryKey: queryKeys.tokenizerModels,
    enabled: false,
    staleTime: 10 * 60_000,
    /** Called by: TanStack Query when the selector opens and requests model inventory because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    queryFn: async () => {
      const { data } = await getTokenizerModels({
        headers: getAuthHeaders(),
        throwOnError: true,
      });
      return data.models;
    },
  });
  const { recommended, other } = partitionTokenizerModelsForLanguage(
    modelQuery.data ?? [],
    detectedLanguage,
  );
  const selectedModel = modelQuery.data?.find((option) => option.model === value);
  const selectValue = value && value.length > 0 ? value : TOKENIZER_MODEL_CLEAR_VALUE;
  const isDisabled = disabled || !column;
  const reason = disabled
    ? disabledReason
    : !column
      ? 'Select a text column first'
      : undefined;

  return (
    <div className={cn('space-y-1', className)}>
      <span className="block text-xs font-medium text-muted-foreground">
        Tokenizer Model
      </span>
      <DisabledReasonTooltip reason={isDisabled ? reason : undefined} className="w-full">
        <Select
          value={selectValue}
          onOpenChange={(open) => {
            if (open && !modelQuery.data && !modelQuery.isFetching) {
              void modelQuery.refetch();
            }
          }}
          onValueChange={(nextValue) => {
            onChange(
              nextValue === TOKENIZER_MODEL_CLEAR_VALUE ? '' : nextValue,
              detectedLanguage,
            );
          }}
          disabled={isDisabled}
        >
          <SelectTrigger className="w-full text-sm" aria-label="Tokenizer model">
            <SelectValue placeholder="Select model">
              {selectedModel?.label ?? (value ? value : 'Select Model')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOKENIZER_MODEL_CLEAR_VALUE}>Select Model</SelectItem>
            {modelQuery.isFetching && !modelQuery.data ? (
              <SelectItem value={TOKENIZER_MODELS_LOADING_VALUE} disabled>
                Loading models...
              </SelectItem>
            ) : null}
            {modelQuery.isError ? (
              <SelectItem value={TOKENIZER_MODELS_ERROR_VALUE} disabled>
                Could not load models
              </SelectItem>
            ) : null}
            {!modelQuery.isFetching && !modelQuery.isError && modelQuery.data?.length === 0 ? (
              <SelectItem value={TOKENIZER_MODELS_EMPTY_VALUE} disabled>
                No models available
              </SelectItem>
            ) : null}
            {recommended.length > 0 ? (
              <SelectGroup
                data-testid="tokenizer-model-recommendations"
                className="my-1 rounded-lg border border-primary/40 bg-transparent p-1 shadow-xs"
              >
                <SelectLabel className="px-2 py-1 text-xs font-medium text-primary">Recommended</SelectLabel>
                {recommended.map((option) => (
                  <SelectItem key={option.model} value={option.model}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{option.model}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {other.map((option) => (
              <SelectItem key={option.model} value={option.model}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option.label}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{option.model}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DisabledReasonTooltip>
    </div>
  );
}

export default TokenizerModelSelector;