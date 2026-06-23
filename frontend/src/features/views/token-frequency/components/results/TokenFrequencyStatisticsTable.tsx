import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type FilterFn,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import HelpIcon from '@/components/help/HelpIcon';
import type { TokenFrequencyStatisticsEntry } from '../../tokenFrequencyAdapters';
import { wildcardToRegExp } from '../../tokenFrequencyAdapters';

export type EnhancedStatisticsRow = TokenFrequencyStatisticsEntry & {
  overuse: boolean;
  signed_ll: number;
  sort_token: string;
  sort_freq_reference: number;
  sort_percent_reference: number;
  sort_freq_study: number;
  sort_percent_study: number;
  sort_log_likelihood_llv: number;
  sort_percent_diff: number;
  sort_bayes_factor_bic: number;
  sort_effect_size_ell: number;
  sort_relative_risk: number;
  sort_log_ratio: number;
  sort_odds_ratio: number;
  sort_significance: number;
};

interface Props {
  statistics: TokenFrequencyStatisticsEntry[];
  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
  /**
   * Optional concordance handoff. When provided, each token in the table
   * becomes a button that opens a concordance search for that token across
   * both compared corpora (no per-node scoping).
   */
  onTokenClick?: (token: string) => void;
  /**
   * Optional controlled wildcard filter. When provided, the table is
   * filtered by this value and the internal search box is not rendered
   * (the filter UI lives in the parent panel for the list view).
   */
  tokenFilter?: string;
  /**
   * Display name + colour for the reference (Corpus 1) and study (Corpus 2)
   * data blocks. Drives the "Reference corpus: ... ; Study corpus: ..."
   * caption rendered under the section heading.
   */
  referenceNodeName?: string | null;
  referenceColor?: string | null;
  studyNodeName?: string | null;
  studyColor?: string | null;
}

/** Used by: token-frequency statistics sorting helpers; parses backend statistic values, including string infinities because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const parseStatisticsNumericValue = (value: unknown): number => {
  if (value === null || value === undefined) return NaN;
  if (value === '+Inf') return Number.POSITIVE_INFINITY;
  if (value === '-Inf') return Number.NEGATIVE_INFINITY;
  return Number(value);
};

/** Used by: TokenFrequencyStatisticsTable column cells to format compact statistic values because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const formatNumber = (
  value: unknown,
  options: { decimals?: number; suffix?: string; multiplier?: number; fallback?: string } = {},
) => {
  const { decimals = 2, suffix = '', multiplier = 1, fallback = 'N/A' } = options;
  if (value === '+Inf') return `+∞${suffix}`;
  if (value === '-Inf') return `-∞${suffix}`;
  const parsed = parseStatisticsNumericValue(value);
  if (!Number.isFinite(parsed)) return fallback;
  return `${(parsed * multiplier).toFixed(decimals)}${suffix}`;
};

/** Used by: TokenFrequencyStatisticsTable signed-LL column cell to show direction markers because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const formatSignedLL = (value: number): string => {
  if (!Number.isFinite(value)) return 'N/A';
  const abs = Math.abs(value).toFixed(2);
  return value >= 0 ? `+${abs}` : `-${abs}`;
};

/** Used by: enhanceRows to convert significance stars into an ordinal sort key because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const significanceRank = (sig: string | undefined): number => (sig ?? '').length;

/** Used by: TokenFrequencyStatisticsTable column definitions as the parent-controlled wildcard token filter because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const tokenWildcardFilter: FilterFn<EnhancedStatisticsRow> = (row, _columnId, filterValue) => {
  const pattern = String(filterValue ?? '').trim();
  if (!pattern) return true;
  const regex = wildcardToRegExp(pattern);
  const token = row.original.sort_token;
  if (!regex) return token.toLowerCase().includes(pattern.toLowerCase());
  return regex.test(token);
};

const columnHelper = createColumnHelper<EnhancedStatisticsRow>();

/**
 * Called by: TokenFrequencyStatisticsTable because it needs TanStack Table column definitions for the keyness grid. Flow: build accessors, attach renderers and filters, then return the column list consumed by the table instance.
 * ``onTokenClick`` (when provided) makes the token cell a button that hands the
 * token to a fresh concordance tab across both compared corpora.
 */
const buildColumns = (onTokenClick?: (token: string) => void) => [
  columnHelper.accessor('sort_token', {
    id: 'token',
    header: 'Token',
    /** Used by: TanStack Table token column to render the original backend token label, optionally as a concordance-launching button, because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => {
      const token = info.row.original.token;
      if (!onTokenClick) {
        return <span className="font-medium">{token}</span>;
      }
      return (
        <button
          type="button"
          className="cursor-pointer font-medium text-left underline-offset-2 hover:underline focus-visible:underline"
          onClick={() => {
            onTokenClick(token);
          }}
          title="Click to inspect in concordance across both corpora."
        >
          {token}
        </button>
      );
    },
    filterFn: tokenWildcardFilter,
  }),
  columnHelper.accessor('sort_freq_reference', {
    id: 'freq_reference',
    header: 'OR',
    /** Used by: TanStack Table OR column to render observed reference frequency as an integer count because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.freq_reference, { decimals: 0 }),
  }),
  columnHelper.accessor('sort_percent_reference', {
    id: 'percent_reference',
    header: '%R',
    /** Used by: TanStack Table %R column to render reference percentage with a percent suffix because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.percent_reference, { decimals: 2, suffix: '%' }),
  }),
  columnHelper.accessor('sort_freq_study', {
    id: 'freq_study',
    header: 'OS',
    /** Used by: TanStack Table OS column to render observed study frequency as an integer count because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.freq_study, { decimals: 0 }),
  }),
  columnHelper.accessor('sort_percent_study', {
    id: 'percent_study',
    header: '%S',
    /** Used by: TanStack Table %S column to render study percentage with a percent suffix because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.percent_study, { decimals: 2, suffix: '%' }),
  }),
  columnHelper.accessor('sort_log_likelihood_llv', {
    id: 'log_likelihood_llv',
    header: 'LL',
    /** Used by: TanStack Table LL column to render log-likelihood for the comparative token row because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.log_likelihood_llv, { decimals: 2 }),
  }),
  columnHelper.accessor('overuse', {
    header: 'Overuse',
    /** Used by: TanStack Table Overuse column to render direction as a compact colored badge because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => {
      const isOveruse = info.getValue();
      const cls = isOveruse ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800';
      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
          {isOveruse ? 'Over' : 'Under'}
        </span>
      );
    },
  }),
  columnHelper.accessor('signed_ll', {
    header: 'Signed LL',
    /** Used by: TanStack Table Signed LL column after overuse direction has been applied because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => <span className="tabular-nums">{formatSignedLL(info.getValue())}</span>,
  }),
  columnHelper.accessor('sort_percent_diff', {
    id: 'percent_diff',
    header: '%DIFF',
    /** Used by: TanStack Table %DIFF column to render percent difference as a percentage value because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) =>
      formatNumber(info.row.original.percent_diff, { decimals: 2, suffix: '%', multiplier: 100 }),
  }),
  columnHelper.accessor('sort_bayes_factor_bic', {
    id: 'bayes_factor_bic',
    header: 'Bayes',
    /** Used by: TanStack Table Bayes column to render the Bayes factor statistic because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.bayes_factor_bic, { decimals: 2 }),
  }),
  columnHelper.accessor('sort_effect_size_ell', {
    id: 'effect_size_ell',
    header: 'ELL',
    /** Used by: TanStack Table ELL column to render the effect-size estimate with extra precision because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.effect_size_ell, { decimals: 4 }),
  }),
  columnHelper.accessor('sort_relative_risk', {
    id: 'relative_risk',
    header: 'RRisk',
    /** Used by: TanStack Table RRisk column to render relative risk for the token comparison because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.relative_risk, { decimals: 2 }),
  }),
  columnHelper.accessor('sort_log_ratio', {
    id: 'log_ratio',
    header: 'LogRatio',
    /** Used by: TanStack Table LogRatio column to render precision suitable for directional comparison because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.log_ratio, { decimals: 4 }),
  }),
  columnHelper.accessor('sort_odds_ratio', {
    id: 'odds_ratio',
    header: 'OddsRatio',
    /** Used by: TanStack Table OddsRatio column to render export-parity odds ratio values because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => formatNumber(info.row.original.odds_ratio, { decimals: 2 }),
  }),
  columnHelper.accessor('sort_significance', {
    id: 'significance',
    header: 'Significance',
    /** Used by: TanStack Table Significance column to render stars as an accessibility-friendly badge because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    cell: (info) => {
      const significance = info.row.original.significance;
      const badgeClass =
        significance === '****'
          ? 'bg-red-100 text-red-800'
          : significance === '***'
            ? 'bg-orange-100 text-orange-800'
            : significance === '**'
              ? 'bg-yellow-100 text-yellow-800'
              : significance === '*'
                ? 'bg-green-100 text-green-800'
                : 'bg-muted text-muted-foreground';
      return (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
        >
          {significance || 'n.s.'}
        </span>
      );
    },
  }),
];

/**
 * Used by: TokenFrequencyStatisticsTable to enrich backend statistics with sort keys and derived overuse direction because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: coerce reference/study frequencies and statistics into sortable numbers, compute overuse and signed LL, then attach sort fields to each row.
 */
const enhanceRows = (statistics: TokenFrequencyStatisticsEntry[]): EnhancedStatisticsRow[] =>
  statistics.map((stat) => {
    const or = stat.freq_reference || 0;
    const os = stat.freq_study || 0;
    const overuse = os > or;
    const ll = parseStatisticsNumericValue(stat.log_likelihood_llv);
    const llAbs = Number.isFinite(ll) ? Math.abs(ll) : NaN;
    const signed_ll = Number.isFinite(llAbs) ? (overuse ? llAbs : -llAbs) : NaN;
    return {
      ...stat,
      overuse,
      signed_ll,
      sort_token: stat.token,
      sort_freq_reference: parseStatisticsNumericValue(stat.freq_reference),
      sort_percent_reference: parseStatisticsNumericValue(stat.percent_reference),
      sort_freq_study: parseStatisticsNumericValue(stat.freq_study),
      sort_percent_study: parseStatisticsNumericValue(stat.percent_study),
      sort_log_likelihood_llv: parseStatisticsNumericValue(stat.log_likelihood_llv),
      sort_percent_diff: parseStatisticsNumericValue(stat.percent_diff),
      sort_bayes_factor_bic: parseStatisticsNumericValue(stat.bayes_factor_bic),
      sort_effect_size_ell: parseStatisticsNumericValue(stat.effect_size_ell),
      sort_relative_risk: parseStatisticsNumericValue(stat.relative_risk),
      sort_log_ratio: parseStatisticsNumericValue(stat.log_ratio),
      sort_odds_ratio: parseStatisticsNumericValue(stat.odds_ratio),
      sort_significance: significanceRank(stat.significance),
    };
  });

/**
 * Rendered by: TokenFrequencyUnifiedTokenSection to show the paginated comparative statistics table for keyness results because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export const TokenFrequencyStatisticsTable = ({
  statistics,
  onDownloadFrequencyCsv,
  onTokenClick,
  tokenFilter: tokenFilterProp,
  referenceNodeName,
  referenceColor,
  studyNodeName,
  studyColor,
}: Props) => {
  const data = useMemo(() => enhanceRows(statistics), [statistics]);
  const columns = useMemo(() => buildColumns(onTokenClick), [onTokenClick]);

  const [sorting, setSorting] = useState<SortingState>([{ id: 'log_likelihood_llv', desc: true }]);
  const tokenFilter = tokenFilterProp ?? '';
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });
  const deferredTokenFilter = useDeferredValue(tokenFilter);
  // Reset to first page whenever the (parent-controlled) filter changes.
  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [tokenFilter]);
  const columnFilters = useMemo(
    () => (deferredTokenFilter.trim() ? [{ id: 'token', value: deferredTokenFilter }] : []),
    [deferredTokenFilter],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination, columnFilters },
    /** Used by: TanStack Table sorting state to keep large tables responsive during header clicks because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    onSortingChange: (updater) => {
      startTransition(() => {
        setSorting(updater);
      });
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: false,
  });

  /**
   * Called by: TokenFrequencyStatisticsTable download button to export filtered or sorted keyness rows because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
   * Flow: choose sorted rows, filtered rows, or full data based on table state and token filter, then delegate CSV download with the keyness label.
   */
  const handleDownload = () => {
    const rows = table
      .getSortedRowModel()
      .rows.filter((row) => row.getIsAllParentsExpanded())
      .map((row) => row.original);
    const effectiveRows = table.getFilteredRowModel().rows.map((row) => row.original);
    const downloadRows = tokenFilter.trim() ? effectiveRows : rows.length > 0 ? rows : data;
    onDownloadFrequencyCsv('token-keyness', downloadRows);
  };

  const pageCount = table.getPageCount() || 1;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty reference name must still let the study name show the caption, so falsy '' must fall through
  const hasCorpusCaption = Boolean(referenceNodeName || studyNodeName);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">Keyword Analysis</h4>
            <HelpIcon
              targetKey="analysis.token-frequency.statistical-measures"
              label="Keyword Analysis"
              tooltip="Comparative token-level keyness statistics for the two selected data blocks."
            />
          </div>
          {hasCorpusCaption ? (
            <p className="text-xs text-muted-foreground">
              <span>Reference corpus: </span>
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty color string must map to undefined (no inline color), so falsy '' must fall through */}
              <span className="font-medium" style={{ color: referenceColor || undefined }}>
                {referenceNodeName ?? '—'}
              </span>
              <span>; Study corpus: </span>
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty color string must map to undefined (no inline color), so falsy '' must fall through */}
              <span className="font-medium" style={{ color: studyColor || undefined }}>
                {studyNodeName ?? '—'}
              </span>
              <span>
                ; The Overuse column indicates how frequently a token appears in the study corpus
                compared to the reference corpus.
              </span>
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-label="Download frequencies"
          title="Download frequencies"
          onClick={handleDownload}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>

      {tokenFilter ? (
        <p className="text-xs text-muted-foreground">
          {filteredCount} match{filteredCount !== 1 ? 'es' : ''} of {totalCount}
        </p>
      ) : null}

      {totalCount > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-300 border-collapse text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b text-left">
                    {headerGroup.headers.map((header) => {
                      const sortDir = header.column.getIsSorted();
                      return (
                        <th key={header.id} className="px-2 py-2 whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto px-0"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sortDir === 'asc' ? (
                              <ArrowUp className="ml-1 h-3.5 w-3.5" />
                            ) : sortDir === 'desc' ? (
                              <ArrowDown className="ml-1 h-3.5 w-3.5" />
                            ) : (
                              <ArrowUpDown className="ml-1 h-3.5 w-3.5 opacity-40" />
                            )}
                          </Button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-2 py-1 whitespace-nowrap tabular-nums">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredCount === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens match the current filter.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="stats-rows-per-page" className="text-xs text-muted-foreground">
                  Rows per page
                </Label>
                <Input
                  id="stats-rows-per-page"
                  type="number"
                  min={5}
                  max={200}
                  value={pageSize}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 5 && next <= 200) {
                      table.setPageSize(next);
                    }
                  }}
                  className="h-8 w-20"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => {
                    table.setPageIndex(0);
                  }}
                >
                  First
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => {
                    table.previousPage();
                  }}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {pageIndex + 1} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!table.getCanNextPage()}
                  onClick={() => {
                    table.nextPage();
                  }}
                >
                  Next
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!table.getCanNextPage()}
                  onClick={() => {
                    table.setPageIndex(pageCount - 1);
                  }}
                >
                  Last
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No statistics available.</p>
      )}
    </div>
  );
};
