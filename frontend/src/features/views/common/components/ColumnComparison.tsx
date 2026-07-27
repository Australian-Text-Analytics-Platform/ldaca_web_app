import { ChevronDown } from 'lucide-react';
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
            <Badge asChild variant="outline" className="px-1.5 py-0 font-normal tabular-nums">
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
              <table
                aria-label={`${referenceColumn} versus ${comparisonColumn} confusion matrix`}
                className="border-collapse text-xs tabular-nums"
              >
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-right font-normal" scope="col">
                      {referenceColumn} ↓ / {comparisonColumn} →
                    </th>
                    {labels.map((comparisonLabel) => (
                      <th key={comparisonLabel} className="px-2 py-1 text-right" scope="col">
                        {displayLabel(comparisonLabel)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((referenceLabel) => (
                    <tr key={referenceLabel}>
                      <th className="px-2 py-1 text-right" scope="row">
                        {displayLabel(referenceLabel)}
                      </th>
                      {labels.map((comparisonLabel) => (
                        <td key={comparisonLabel} className="px-2 py-1 text-right">
                          {countByPair.get(JSON.stringify([referenceLabel, comparisonLabel])) ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TooltipContent>
        </Tooltip>
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
