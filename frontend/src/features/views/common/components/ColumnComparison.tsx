import { ArrowDown, ArrowRight, ChevronDown, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type ConfusionCount,
  INTERCODER_RELIABILITY_METRICS,
  type IntercoderReliabilityMetric,
  calculateIntercoderReliability,
  formatIntercoderReliability,
  isIntercoderReliabilityMetric,
} from '@/features/views/common/columnComparisonModel';

export type { ConfusionCount } from '@/features/views/common/columnComparisonModel';

const displayLabel = (value: string): string => (value === '' ? '(blank)' : value);

interface ColumnComparisonHeaderProps {
  label?: string;
  metric: IntercoderReliabilityMetric;
  referenceColumn: string;
  comparisonColumn: string;
  rows: ConfusionCount[] | undefined;
  isLoading: boolean;
  isError: boolean;
  differenceFilterActive?: boolean;
  onDifferenceFilterChange?: (active: boolean) => void;
}

/** Shows reliability beside a compared column and exact pair counts on hover or focus. */
export function ColumnComparisonHeader({
  label,
  metric,
  referenceColumn,
  comparisonColumn,
  rows,
  isLoading,
  isError,
  differenceFilterActive = false,
  onDifferenceFilterChange,
}: ColumnComparisonHeaderProps) {
  const labels = Array.from(
    new Set((rows ?? []).flatMap((row) => [row.reference, row.comparison])),
  ).toSorted((a, b) => a.localeCompare(b));
  const countByPair = new Map(
    (rows ?? []).map((row) => [JSON.stringify([row.reference, row.comparison]), row.count]),
  );
  const metricDefinition = INTERCODER_RELIABILITY_METRICS.find((option) => option.value === metric);
  const reliability = rows ? calculateIntercoderReliability(rows, metric) : null;
  const accessibleScore =
    reliability == null
      ? null
      : metric === 'percent_agreement'
        ? `${(reliability * 100).toFixed(1)}%`
        : reliability.toFixed(3);
  const score = isLoading
    ? `${metricDefinition?.symbol ?? ''} …`
    : reliability == null
      ? `${metricDefinition?.symbol ?? ''} —`
      : formatIntercoderReliability(reliability, metric);
  const scoreDescription = isLoading
    ? `${metricDefinition?.label ?? ''} loading for ${referenceColumn} versus ${comparisonColumn}`
    : isError || !rows || reliability == null
      ? `${metricDefinition?.label ?? ''} unavailable for ${referenceColumn} versus ${comparisonColumn}`
      : `${metricDefinition?.label ?? ''} ${accessibleScore ?? ''} for ${referenceColumn} versus ${comparisonColumn}`;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label ?? comparisonColumn}</span>
      <TooltipProvider delayDuration={120} skipDelayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              asChild
              variant="outline"
              className="h-7 px-2.5 text-sm font-medium tabular-nums"
            >
              <button type="button" aria-label={scoreDescription}>
                {score}
              </button>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-none p-3">
            {isLoading ? (
              <p>Loading comparison...</p>
            ) : isError || !rows ? (
              <p>Could not load comparison.</p>
            ) : labels.length === 0 ? (
              <p>No rows contain values in both columns.</p>
            ) : (
              <div className="grid grid-cols-[auto_auto] grid-rows-[auto_auto] gap-x-2 gap-y-1">
                <div
                  aria-label={`${comparisonColumn} column axis`}
                  className="col-start-2 row-start-1 flex items-center justify-center gap-1 border-b border-primary-foreground/25 pb-1 font-medium"
                >
                  <span>{comparisonColumn}</span>
                  <ArrowRight aria-hidden="true" className="size-3" />
                </div>
                <div
                  aria-label={`${referenceColumn} row axis`}
                  className="col-start-1 row-start-2 flex flex-col items-center justify-center gap-1 border-r border-primary-foreground/25 pr-1.5 font-medium"
                >
                  <span className="rotate-180 [writing-mode:vertical-rl]">{referenceColumn}</span>
                  <ArrowDown aria-hidden="true" className="size-3" />
                </div>
                <table
                  aria-label={`${referenceColumn} versus ${comparisonColumn} confusion matrix`}
                  className="col-start-2 row-start-2 border-separate border-spacing-x-2 border-spacing-y-1 text-xs tabular-nums"
                >
                  <caption className="sr-only">
                    Rows are {referenceColumn}; columns are {comparisonColumn}.
                  </caption>
                  <thead>
                    <tr>
                      <th className="px-1 font-normal" scope="col">
                        <span className="sr-only">Row label</span>
                      </th>
                      {labels.map((comparisonLabel) => (
                        <th
                          key={comparisonLabel}
                          className="px-1 text-center text-primary-foreground/80"
                          scope="col"
                        >
                          {displayLabel(comparisonLabel)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {labels.map((referenceLabel) => (
                      <tr key={referenceLabel}>
                        <th className="pr-2 text-right text-primary-foreground/80" scope="row">
                          {displayLabel(referenceLabel)}
                        </th>
                        {labels.map((comparisonLabel) => (
                          <td
                            key={comparisonLabel}
                            className="min-w-8 px-1 text-center font-medium"
                          >
                            {countByPair.get(JSON.stringify([referenceLabel, comparisonLabel])) ??
                              0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
        {onDifferenceFilterChange ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={differenceFilterActive ? 'secondary' : 'outline'}
                size="icon"
                className="size-7"
                aria-label={`Filter difference for ${comparisonColumn}`}
                aria-pressed={differenceFilterActive}
                onClick={() => {
                  onDifferenceFilterChange(!differenceFilterActive);
                }}
              >
                <Filter aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Filter difference</TooltipContent>
          </Tooltip>
        ) : null}
      </TooltipProvider>
    </span>
  );
}

interface ColumnComparisonSelectorProps {
  availableColumns: string[];
  selectedColumns: string[];
  onSelectedColumnsChange: (columns: string[]) => void;
  metric: IntercoderReliabilityMetric;
  onMetricChange: (metric: IntercoderReliabilityMetric) => void;
  disabled?: boolean;
}

/** Shared immediate multi-column checklist for Annotation comparison surfaces. */
export function ColumnComparisonSelector({
  availableColumns,
  selectedColumns,
  onSelectedColumnsChange,
  metric,
  onMetricChange,
  disabled = false,
}: ColumnComparisonSelectorProps) {
  const normalizedAvailableColumns = Array.from(new Set(availableColumns));
  const normalizedSelectedColumns = selectedColumns.filter((column) =>
    normalizedAvailableColumns.includes(column),
  );
  const allSelected =
    normalizedAvailableColumns.length > 0 &&
    normalizedAvailableColumns.every((column) => normalizedSelectedColumns.includes(column));

  const toggleColumn = (column: string, checked: boolean) => {
    onSelectedColumnsChange(
      checked
        ? Array.from(new Set([...normalizedSelectedColumns, column]))
        : normalizedSelectedColumns.filter((selectedColumn) => selectedColumn !== column),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || normalizedAvailableColumns.length === 0}
          aria-label="Compare To"
        >
          Compare To ({normalizedSelectedColumns.length})
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Intercoder reliability</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={metric}
          onValueChange={(value) => {
            if (isIntercoderReliabilityMetric(value)) onMetricChange(value);
          }}
        >
          {INTERCODER_RELIABILITY_METRICS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              onSelect={(event) => {
                event.preventDefault();
              }}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={allSelected}
          disabled={normalizedAvailableColumns.length === 0}
          onCheckedChange={(checked) => {
            onSelectedColumnsChange(checked ? normalizedAvailableColumns : []);
          }}
          onSelect={(event) => {
            event.preventDefault();
          }}
        >
          Select all
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {normalizedAvailableColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={normalizedSelectedColumns.includes(column)}
            onCheckedChange={(checked) => {
              toggleColumn(column, checked);
            }}
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            {column}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
