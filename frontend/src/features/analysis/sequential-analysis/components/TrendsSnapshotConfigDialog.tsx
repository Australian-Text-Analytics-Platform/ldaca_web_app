/**
 * Snapshot-capture configuration dialog for Trends (sequential-analysis).
 *
 * Replaces the standard <SaveSnapshotDialog> for Trends only via the
 * <SnapshotActions> ``saveDialog`` override. Trends snapshots are
 * **data-rich captures** — the user picks the finest time bin (or
 * finest numeric interval) and which metadata columns to ship. The
 * viewer then re-aggregates client-side to coarser frequencies and
 * fewer group dimensions (chunks (b)/(c) of the plan).
 *
 * Hard cap on captured row count: 200,000. Soft warn at 100,000.
 * Estimate is computed client-side from corpus time-range + frequency
 * + group cardinalities; a backend dry-run kicks in when the estimate
 * comes within striking distance of the cap.
 *
 * This component is a *controlled* dialog over the parent feature's
 * snapshot config state. The parent passes a current `config` and an
 * `onConfigChange` callback. The dialog's Save button invokes the
 * standard wrapped `onSave(filename, description)` from
 * SnapshotActions; the Trends feature's `handleSaveSnapshot` closure
 * reads its config state and runs the capture flow.
 */
import React, { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, FolderPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SNAPSHOT_FINEST_FREQUENCIES,
} from '@/api/text';
import { nodesApi } from '@/api/index';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/hooks/useAuth';
import type { SnapshotToolKey } from '@/features/snapshot-view';
import type { SnapshotFinestFrequency, TrendsSnapshotConfig } from '../trendsSnapshotConfig';

export const SNAPSHOT_ROW_HARD_CAP = 200_000;
export const SNAPSHOT_ROW_SOFT_WARN = 100_000;

/** The frequencies the snapshot capture dialog exposes — all presets
 * except ``custom``. The viewer's coarsening pass uses this same
 * ordered list: a snapshot captured at ``daily`` can be re-aggregated
 * to ``weekly`` / ``monthly`` / etc., but not to ``hourly``. */
const FREQUENCY_LABELS: Record<SnapshotFinestFrequency, string> = {
  second: 'Per second',
  minute: 'Per minute',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const INVALID_NAME_CHARS = /[/\\:*?"<>|]/g;

function sanitiseName(raw: string): string {
  return raw.replace(INVALID_NAME_CHARS, '_').trim();
}

interface NameValidation {
  ok: boolean;
  error: string | null;
}

function validateName(
  rawName: string,
  tool: SnapshotToolKey,
  existingFilenames: string[],
): NameValidation {
  const trimmed = rawName.trim();
  if (!trimmed) return { ok: false, error: null };
  if (INVALID_NAME_CHARS.test(rawName)) {
    return { ok: false, error: 'Name contains invalid characters: / \\ : * ? " < > |' };
  }
  const filename = `${tool}-${sanitiseName(rawName)}.ldaca-snapshot`;
  if (existingFilenames.includes(filename)) {
    return { ok: false, error: 'A snapshot with this name already exists.' };
  }
  return { ok: true, error: null };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: SnapshotToolKey;
  existingFilenames: string[];
  defaultName: string;
  /** Wrapped onSave from <SnapshotActions> (filename + description).
   * The dialog calls this when the user confirms; the Trends feature's
   * own handleSaveSnapshot closure reads the config state at call
   * time and runs the capture. */
  onSave: (filename: string, description: string) => Promise<void>;

  /** Controlled config state from the Trends feature. */
  config: TrendsSnapshotConfig;
  onConfigChange: (next: TrendsSnapshotConfig) => void;
  /** ``datetime`` or ``numeric`` — driven by the live tool's column
   * choice. Affects which set of bin controls renders. */
  columnType: 'datetime' | 'numeric';
  /** Metadata columns the user may pick to group by. Comes from the
   * live workspace's schema, filtered to non-time columns. */
  availableGroupByColumns: string[];
  /** Workspace + node identifiers — used by the dialog to fetch real
   * unique-value counts for ticked group-by columns via
   * ``nodesApi.uniqueValues``. The result feeds the estimator's
   * cardinality product so the row count is accurate within a
   * factor of the time-bucket estimate. Without these the estimator
   * falls back to a flat assumption of 10 distinct values per column. */
  workspaceId: string | null;
  nodeId: string;
  /** Source-block row count (upper bound on captured rows). */
  nodeRowCount: number;
  /** Span of the captured time range in years, inferred from the live
   * result's earliest / latest time_period. ``null`` when the live
   * result has fewer than two time buckets — in that case the dialog
   * falls back to assuming a one-year span. */
  yearsSpanHint: number | null;
  /** Optional async dry-run that calls the backend with the chosen
   * config and returns the actual row count. The dialog uses this when
   * the estimate creeps within striking distance of the cap. */
  dryRunRowCount?: (config: TrendsSnapshotConfig) => Promise<number>;
}

export const TrendsSnapshotConfigDialog: React.FC<Props> = ({ open, ...contentProps }) => (
  <Dialog open={open} onOpenChange={contentProps.onOpenChange}>
    {open ? <TrendsSnapshotConfigDialogContent key={contentProps.defaultName} {...contentProps} /> : null}
  </Dialog>
);

const TrendsSnapshotConfigDialogContent: React.FC<Omit<Props, 'open'>> = ({
  onOpenChange,
  tool,
  existingFilenames,
  defaultName,
  onSave,
  config,
  onConfigChange,
  columnType,
  availableGroupByColumns,
  workspaceId,
  nodeId,
  nodeRowCount,
  yearsSpanHint,
  dryRunRowCount,
}) => {
  const { getAuthHeaders } = useAuth();

  // Fetch real unique-value counts for the ticked group-by columns.
  // React Query caches by (workspaceId, nodeId, columnName), so
  // re-ticking a column hits the cache instantly. Unticked columns
  // don't fetch — the estimator falls back to 10 for any column whose
  // count isn't yet loaded (a conservative under-estimate).
  const cardinalityQueries = useQueries({
    queries: config.groupByColumns.map((col) => ({
      queryKey: queryKeys.columnUniqueValues(workspaceId ?? '', nodeId, col),
      queryFn: () => nodesApi.uniqueValues(nodeId, col, getAuthHeaders()),
      enabled: Boolean(workspaceId && nodeId && col),
      staleTime: 5 * 60_000,
    })),
  });
  const cardinalityByColumn: Record<string, number | null> = useMemo(() => {
    const map: Record<string, number | null> = {};
    config.groupByColumns.forEach((col, idx) => {
      const q = cardinalityQueries[idx];
      map[col] = q?.data?.unique_count ?? null;
    });
    return map;
  }, [config.groupByColumns, cardinalityQueries]);
  const cardinalitiesLoading = cardinalityQueries.some((q) => q.isLoading);

  // Pure-JS estimator: corpus time-span × buckets-per-year × cardinality
  // product. Cardinalities default to 10 for any ticked column not yet
  // resolved by ``cardinalityByColumn``.
  const estimateRowCount = (cfg: TrendsSnapshotConfig): number => {
    if (nodeRowCount <= 0) return 0;
    if (columnType === 'numeric') {
      const interval = Math.max(cfg.numericInterval || 1, 0.0001);
      const buckets = Math.max(1, Math.ceil(nodeRowCount / interval));
      const groupProduct = cfg.groupByColumns.reduce((product, col) => {
        const cardinality = cardinalityByColumn[col] ?? 10;
        return product * Math.max(1, cardinality);
      }, 1);
      return Math.min(nodeRowCount, buckets * groupProduct);
    }
    const bucketsPerYearByFreq: Record<SnapshotFinestFrequency, number> = {
      second: 31_536_000,
      minute: 525_600,
      hourly: 8_760,
      daily: 365,
      weekly: 52,
      monthly: 12,
      quarterly: 4,
      yearly: 1,
    };
    const years = yearsSpanHint && yearsSpanHint > 0 ? yearsSpanHint : 1;
    const buckets = Math.max(1, Math.ceil(bucketsPerYearByFreq[cfg.finestFrequency] * years));
    const groupProduct = cfg.groupByColumns.reduce((product, col) => {
      const cardinality = cardinalityByColumn[col] ?? 10;
      return product * Math.max(1, cardinality);
    }, 1);
    return Math.min(buckets * groupProduct, nodeRowCount * groupProduct);
  };
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [actualRowsResult, setActualRowsResult] = useState<{ signature: string; rows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configSignature = `${config.finestFrequency}|${config.groupByColumns.join('\0')}|${config.numericInterval}|${config.numericOrigin ?? ''}`;
  const actualRows = actualRowsResult?.signature === configSignature ? actualRowsResult.rows : null;

  const nameValidation = useMemo(
    () => validateName(name, tool, existingFilenames),
    [name, tool, existingFilenames],
  );

  const estimatedRows = estimateRowCount(config);
  const effectiveRowCount = actualRows ?? estimatedRows;
  const isOverCap = effectiveRowCount > SNAPSHOT_ROW_HARD_CAP;
  const isOverSoft = effectiveRowCount > SNAPSHOT_ROW_SOFT_WARN;
  // Estimator accuracy degrades for skewed time distributions; offer
  // dry-run any time we're within 50% of the cap so the user has a
  // path to verify before saving.
  const isEstimateClose = estimatedRows > SNAPSHOT_ROW_HARD_CAP / 2;
  const canDryRun = isEstimateClose && Boolean(dryRunRowCount);

  const handleDryRun = async () => {
    if (!dryRunRowCount) return;
    setIsEstimating(true);
    setError(null);
    try {
      const actual = await dryRunRowCount(config);
        setActualRowsResult({ signature: configSignature, rows: actual });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsEstimating(false);
    }
  };

  const handleFinestFrequency = (value: SnapshotFinestFrequency) => {
    onConfigChange({ ...config, finestFrequency: value });
  };

  const handleNumericInterval = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      onConfigChange({ ...config, numericInterval: parsed });
    }
  };

  const handleNumericOrigin = (raw: string) => {
    if (raw.trim() === '') {
      onConfigChange({ ...config, numericOrigin: null });
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      onConfigChange({ ...config, numericOrigin: parsed });
    }
  };

  const toggleGroupColumn = (col: string) => {
    const next = config.groupByColumns.includes(col)
      ? config.groupByColumns.filter((c) => c !== col)
      : [...config.groupByColumns, col];
    if (next.length > 3) return; // cap at 3
    onConfigChange({ ...config, groupByColumns: next });
  };

  const handleSave = async () => {
    if (!nameValidation.ok || isOverCap || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const filename = `${tool}-${sanitiseName(name)}.ldaca-snapshot`;
      await onSave(filename, description);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

    return (
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Save Trends snapshot</DialogTitle>
          <DialogDescription>
            Pick the finest granularity to capture. The snapshot viewer can re-aggregate to
            coarser frequencies and fewer group dimensions client-side — but it can't go finer
            than what you save here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Finest bin */}
          {columnType === 'datetime' ? (
            <div className="space-y-1.5">
              <Label htmlFor="snap-finest-freq">Finest time bin</Label>
              <Select
                value={config.finestFrequency}
                onValueChange={(v) => handleFinestFrequency(v as SnapshotFinestFrequency)}
              >
                <SelectTrigger id="snap-finest-freq" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SNAPSHOT_FINEST_FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {FREQUENCY_LABELS[freq]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Viewers can coarsen but not refine. Smaller bins = larger capture.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="snap-num-interval">Finest numeric bin</Label>
                <Input
                  id="snap-num-interval"
                  type="number"
                  min="0"
                  step="any"
                  value={String(config.numericInterval)}
                  onChange={(e) => handleNumericInterval(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Default 1.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="snap-num-origin">Origin (optional)</Label>
                <Input
                  id="snap-num-origin"
                  type="number"
                  step="any"
                  value={config.numericOrigin == null ? '' : String(config.numericOrigin)}
                  onChange={(e) => handleNumericOrigin(e.target.value)}
                  placeholder="Auto-detect"
                />
                <p className="text-xs text-muted-foreground">Blank = data min.</p>
              </div>
            </div>
          )}

          {/* Group-by columns */}
          <div className="space-y-1.5">
            <Label>Group-by columns ({config.groupByColumns.length}/3)</Label>
            {availableGroupByColumns.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No metadata columns available on the active data block.
              </p>
            ) : (
              <div className="max-h-32 overflow-y-auto rounded-md border border-input p-2">
                {availableGroupByColumns.map((col) => {
                  const checked = config.groupByColumns.includes(col);
                  const disabled = !checked && config.groupByColumns.length >= 3;
                  // Only ticked columns are queried — when unticked,
                  // ``cardinalityByColumn`` won't have an entry, and we
                  // suppress the chip rather than show "10" (the
                  // estimator's default).
                  const cardinality = checked ? cardinalityByColumn[col] : null;
                  return (
                    <label
                      key={col}
                      className={`flex items-center gap-2 px-1 py-1 text-sm ${
                        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={() => toggleGroupColumn(col)}
                      />
                      <span className="flex-1">{col}</span>
                      {checked && (
                        cardinality == null
                          ? <span className="text-xs text-muted-foreground">…</span>
                          : <span className="text-xs text-muted-foreground">{cardinality} unique</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Pick up to 3. Viewers can hide groups but not add new ones.
            </p>
          </div>

          {/* Row estimate + cap */}
          <div className="space-y-1.5 rounded-md border border-input p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">Estimated rows</span>
              <span className={isOverCap ? 'font-mono text-destructive' : isOverSoft ? 'font-mono text-amber-600 dark:text-amber-400' : 'font-mono'}>
                ~{effectiveRowCount.toLocaleString()}
                {actualRows != null && (
                  <span className="ml-1 text-xs text-muted-foreground">(actual)</span>
                )}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Cap {SNAPSHOT_ROW_HARD_CAP.toLocaleString()} · warn over {SNAPSHOT_ROW_SOFT_WARN.toLocaleString()}.
              {cardinalitiesLoading && (
                <span className="ml-1 italic">Loading column cardinalities…</span>
              )}
            </div>
            {isOverCap && (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Over the hard cap. Try a coarser bin or fewer group columns.
                </span>
              </div>
            )}
            {!isOverCap && isOverSoft && (
              <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Large capture — viewer aggregation will still be snappy, but the bundle is bigger.
                </span>
              </div>
            )}
            {canDryRun && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isEstimating}
                onClick={handleDryRun}
                className="mt-1"
              >
                {isEstimating ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Computing…
                  </>
                ) : (
                  'Verify actual row count'
                )}
              </Button>
            )}
          </div>

          {/* Filename + description */}
          <div className="space-y-1.5">
            <Label htmlFor="snap-name">Filename</Label>
            <Input
              id="snap-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName}
            />
            <p className="text-xs text-muted-foreground">
              On disk: {tool}-{sanitiseName(name) || '<name>'}.ldaca-snapshot
            </p>
            {nameValidation.error && (
              <p className="text-xs text-destructive">{nameValidation.error}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snap-desc">Description (optional)</Label>
            <textarea
              id="snap-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="What this snapshot demonstrates."
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!nameValidation.ok || isOverCap || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <FolderPlus className="mr-2 h-4 w-4" />
                Save
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
  );
};
