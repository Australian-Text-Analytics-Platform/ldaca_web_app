import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  calculateCohensKappa,
  type ConfusionCount,
} from '@/features/views/common/columnComparisonModel';

export type { ConfusionCount } from '@/features/views/common/columnComparisonModel';

const displayLabel = (value: string): string => (value === '' ? '(blank)' : value);

const cellIntensityClass = (count: number, maximum: number): string => {
  if (count === 0 || maximum === 0) return 'bg-muted/70';
  const level = Math.max(1, Math.ceil((count / maximum) * 4));
  if (level === 1) return 'bg-sky-200 dark:bg-sky-950';
  if (level === 2) return 'bg-sky-300 dark:bg-sky-800';
  if (level === 3) return 'bg-sky-400 dark:bg-sky-700';
  return 'bg-sky-500 dark:bg-sky-500';
};

interface ConfusionMatrixProps {
  referenceColumn: string;
  comparisonColumn: string;
  rows: ConfusionCount[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

/** Shared activity-grid presentation for Manual, Review, and page-scoped Preview comparisons. */
export function ConfusionMatrix({
  referenceColumn,
  comparisonColumn,
  rows,
  isLoading,
  isError,
}: ConfusionMatrixProps) {
  if (isLoading) {
    return (
      <section className="rounded-lg border bg-card p-4">
        <h4 className="font-medium">
          {referenceColumn} vs {comparisonColumn}
        </h4>
        <p className="mt-2 text-sm text-muted-foreground">Loading comparison...</p>
      </section>
    );
  }
  if (isError || !rows) {
    return (
      <section className="rounded-lg border bg-card p-4">
        <h4 className="font-medium">
          {referenceColumn} vs {comparisonColumn}
        </h4>
        <p className="mt-2 text-sm text-destructive">Could not load comparison.</p>
      </section>
    );
  }

  const labels = Array.from(
    new Set(rows.flatMap((row) => [row.reference, row.comparison])),
  ).toSorted((a, b) => a.localeCompare(b));
  const countByPair = new Map(
    rows.map((row) => [JSON.stringify([row.reference, row.comparison]), row.count]),
  );
  const maximum = rows.reduce((current, row) => Math.max(current, row.count), 0);
  const cohensKappa = calculateCohensKappa(rows);

  return (
    <section className="rounded-lg border bg-card p-4">
      <h4 className="font-medium">
        {referenceColumn} vs {comparisonColumn}
      </h4>
      {labels.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No rows contain values in both columns.
        </p>
      ) : (
        <TooltipProvider delayDuration={120} skipDelayDuration={0}>
          <p className="mt-2 text-xs text-muted-foreground">
            Rows: {referenceColumn} · Columns: {comparisonColumn}
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-6">
            <div aria-label="Confusion matrix" className="w-fit max-w-full">
              <div className="overflow-x-auto pb-1">
                <table className="border-separate border-spacing-1 text-xs">
                  <thead>
                    <tr>
                      <th className="max-w-36 pr-2 text-right align-bottom font-normal text-muted-foreground">
                        <span className="sr-only">
                          {referenceColumn} rows and {comparisonColumn} columns
                        </span>
                      </th>
                      {labels.map((label) => (
                        <th
                          key={label}
                          scope="col"
                          aria-label={`${displayLabel(label)} comparison column`}
                          className="h-16 w-6 min-w-6 p-0 align-bottom font-normal text-muted-foreground"
                          title={displayLabel(label)}
                        >
                          <span className="relative block h-16 w-6">
                            <span className="absolute bottom-1 left-1/2 origin-bottom-left -rotate-45 whitespace-nowrap">
                              {displayLabel(label)}
                            </span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {labels.map((referenceLabel) => (
                      <tr key={referenceLabel}>
                        <th
                          scope="row"
                          className="max-w-36 truncate pr-2 text-right font-normal text-muted-foreground"
                          title={displayLabel(referenceLabel)}
                        >
                          {displayLabel(referenceLabel)}
                        </th>
                        {labels.map((comparisonLabel) => {
                          const count =
                            countByPair.get(JSON.stringify([referenceLabel, comparisonLabel])) ?? 0;
                          const description = `${referenceColumn} ${displayLabel(referenceLabel)}, ${comparisonColumn} ${displayLabel(comparisonLabel)}: ${String(count)} rows`;
                          return (
                            <td key={comparisonLabel} className="p-0.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    role="img"
                                    tabIndex={0}
                                    aria-label={description}
                                    className={`block size-5 cursor-default rounded-sm outline-hidden ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${cellIntensityClass(count, maximum)}`}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="top">{description}</TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                aria-label="Confusion matrix count scale"
                className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"
              >
                <span>Lower count</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <span
                    key={level}
                    aria-hidden="true"
                    className={`size-3 rounded-sm ${cellIntensityClass(level, 4)}`}
                  />
                ))}
                <span>Higher count</span>
              </div>
            </div>
            <div aria-label="Intercoder reliability" className="space-y-2">
              <h5 className="text-sm font-medium">Intercoder reliability</h5>
              <dl className="min-w-36 rounded-md border bg-muted/30 px-4 py-3">
                <dt className="text-xs text-muted-foreground">Cohen’s Kappa</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {cohensKappa == null ? 'Not available' : cohensKappa.toFixed(3)}
                </dd>
              </dl>
            </div>
          </div>
        </TooltipProvider>
      )}
    </section>
  );
}

interface ColumnComparisonDialogProps {
  open: boolean;
  referenceColumn: string;
  availableColumns: string[];
  selectedColumns: string[];
  scopeDescription: string;
  onOpenChange: (open: boolean) => void;
  onSelectedColumnsChange: (columns: string[]) => void;
  onCompare: () => void;
}

/** Shared multi-column chooser for Annotation comparison surfaces. */
export function ColumnComparisonDialog({
  open,
  referenceColumn,
  availableColumns,
  selectedColumns,
  scopeDescription,
  onOpenChange,
  onSelectedColumnsChange,
  onCompare,
}: ColumnComparisonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compare annotation columns</DialogTitle>
          <DialogDescription>
            Select one or more columns to compare with {referenceColumn} {scopeDescription}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-3">
          {availableColumns.map((column) => (
            <label
              key={column}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60"
            >
              <Checkbox
                aria-label={column}
                checked={selectedColumns.includes(column)}
                onCheckedChange={(checked) => {
                  onSelectedColumnsChange(
                    checked
                      ? Array.from(new Set([...selectedColumns, column]))
                      : selectedColumns.filter((item) => item !== column),
                  );
                }}
              />
              <span className="min-w-0 break-all text-sm">{column}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" disabled={selectedColumns.length === 0} onClick={onCompare}>
            Compare
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
