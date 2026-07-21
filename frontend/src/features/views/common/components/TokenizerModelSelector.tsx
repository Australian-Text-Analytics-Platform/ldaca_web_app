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
import { listTokenizerModels } from '@/api';
import type { TokenizerModelInfo } from '@/api/frontendModels';
import { queryKeys } from '@/lib/queryKeys';
import { partitionTokenizerModelsForLanguage } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { useDetectedColumnLanguage } from '../hooks/useDetectedColumnLanguage';

const TOKENIZER_MODELS_LOADING_VALUE = '__ldaca__tokenizer_models_loading__';
const TOKENIZER_MODELS_ERROR_VALUE = '__ldaca__tokenizer_models_error__';
const TOKENIZER_MODELS_EMPTY_VALUE = '__ldaca__tokenizer_models_empty__';
const TOKENIZER_MODEL_CLEAR_VALUE = '__ldaca__select_tokenizer_model__';

interface TokenizerModelSelectorProps {
  workspaceId: string | null;
  nodeId: string;
  column: string;
  value?: string;
  onChange: (value: string, detectedLanguage: string | null) => void;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

/**
 * Lets token-based analysis panels choose a tokenizer model for the selected
 * source column, using sampled text to group backend models by detected language.
 * Used by: concordance and token-frequency parameter panels.
 */
function TokenizerModelSelector({
  workspaceId,
  nodeId,
  column,
  value,
  onChange,
  disabled = false,
  disabledReason,
  className,
}: TokenizerModelSelectorProps) {
  const canFetchSample = Boolean(workspaceId && nodeId && column);
  const { detectedLanguage } = useDetectedColumnLanguage({
    workspaceId,
    nodeId,
    column,
    enabled: canFetchSample,
  });

  const modelQuery = useQuery({
    queryKey: queryKeys.tokenizerModels,
    enabled: false,
    staleTime: 10 * 60_000,
    /** Called by: TanStack Query when the selector opens and requests model inventory. */
    queryFn: async (): Promise<TokenizerModelInfo[]> => {
      const { data } = await listTokenizerModels({
        throwOnError: true,
      });
      return data.map((model) => ({
        model: model.id,
        label: model.label,
        languages: model.languages ?? [],
      }));
    },
  });
  const { recommended, other } = partitionTokenizerModelsForLanguage(
    modelQuery.data ?? [],
    detectedLanguage,
  );
  const selectedModel = modelQuery.data?.find((option) => option.model === value);
  const selectValue = value && value.length > 0 ? value : TOKENIZER_MODEL_CLEAR_VALUE;
  const isDisabled = disabled || !column;
  const reason = disabled ? disabledReason : !column ? 'Select a text column first' : undefined;

  return (
    <div className={cn('space-y-1', className)}>
      <span className="block text-xs font-medium text-muted-foreground">Tokenizer Model</span>
      <DisabledReasonTooltip reason={isDisabled ? reason : undefined} className="w-full">
        <Select
          value={selectValue}
          onOpenChange={(open) => {
            if (open && !modelQuery.data && !modelQuery.isFetching) {
              void modelQuery.refetch();
            }
          }}
          onValueChange={(nextValue) => {
            onChange(nextValue === TOKENIZER_MODEL_CLEAR_VALUE ? '' : nextValue, detectedLanguage);
          }}
          disabled={isDisabled}
        >
          <SelectTrigger className="w-full text-sm" aria-label="Tokenizer model">
            <SelectValue placeholder="None">
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty value should display the placeholder, not '' */}
              {selectedModel?.label ?? (value ? value : 'None')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOKENIZER_MODEL_CLEAR_VALUE}>None</SelectItem>
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
                <SelectLabel className="px-2 py-1 text-xs font-medium text-primary">
                  Recommended
                </SelectLabel>
                {recommended.map((option) => (
                  <SelectItem key={option.model} value={option.model}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {option.model}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {other.map((option) => (
              <SelectItem key={option.model} value={option.model}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option.label}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {option.model}
                  </span>
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
