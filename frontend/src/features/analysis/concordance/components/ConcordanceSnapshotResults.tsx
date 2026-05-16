import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CONCORDANCE_COLUMN_KEYS } from '@/features/analysis/generatedColumns';
import {
  flattenConcordanceGroups,
  buildDispersionRows,
  type ConcordanceDispersionRow,
} from '../concordanceViewModels';
import type { ConcordanceHitRow, ConcordanceResultEntry } from '@/api/text/concordance';
import { ConcordanceDispersionSummary } from './ConcordanceDispersionSummary';
import type { ConcordanceSnapshotPayload } from '../hooks/useConcordanceSnapshotLoad';
import type { SnapshotManifest } from '@/features/snapshot-view';

interface ConcordanceSnapshotResultsProps {
  manifest: SnapshotManifest;
  payload: ConcordanceSnapshotPayload;
}

const PAGE_SIZE = 20;

const HIT_COLUMNS: Array<{ key: string; label: string; align?: 'left' | 'center' | 'right' }> = [
  { key: CONCORDANCE_COLUMN_KEYS.leftContext, label: 'Left context', align: 'right' },
  { key: CONCORDANCE_COLUMN_KEYS.matchedText, label: 'Matched', align: 'center' },
  { key: CONCORDANCE_COLUMN_KEYS.rightContext, label: 'Right context', align: 'left' },
];

/** Concordance result tab for a single node — flattens the per-doc
 * groups into individual hit rows and client-side-paginates them. */
const NodeResultTab: React.FC<{
  nodeId: string;
  nodeLabel: string;
  entry: ConcordanceResultEntry;
  dispersionRows: ConcordanceDispersionRow[];
  dispersionTextColumn: string;
  searchTerm: string;
  binsRows: import('../concordanceViewModels').TaggedBinRow[];
  materialised: boolean;
}> = ({
  nodeId,
  nodeLabel,
  entry,
  dispersionRows,
  dispersionTextColumn,
  searchTerm,
  binsRows,
  materialised,
}) => {
  const allHits: ConcordanceHitRow[] = useMemo(
    () => flattenConcordanceGroups(entry.data ?? []),
    [entry.data],
  );

  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(allHits.length / PAGE_SIZE));
  const pagedHits = useMemo(
    () => allHits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [allHits, page],
  );

  const allMatchedTexts = useMemo(() => {
    const seen = new Set<string>();
    for (const hit of allHits) {
      const t = hit[CONCORDANCE_COLUMN_KEYS.matchedText];
      if (typeof t === 'string') seen.add(t);
    }
    return Array.from(seen);
  }, [allHits]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            Hits — {nodeLabel}
            <Badge variant="secondary" className="text-xs font-normal">
              {allHits.length.toLocaleString()} row
              {allHits.length === 1 ? '' : 's'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {allHits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hits in this data block.
            </p>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {HIT_COLUMNS.map((col) => (
                        <TableHead
                          key={col.key}
                          className={
                            col.align === 'right'
                              ? 'text-right'
                              : col.align === 'center'
                                ? 'text-center'
                                : 'text-left'
                          }
                        >
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedHits.map((hit, idx) => (
                      <TableRow key={`${nodeId}-${(page - 1) * PAGE_SIZE + idx}`}>
                        {HIT_COLUMNS.map((col) => (
                          <TableCell
                            key={col.key}
                            className={
                              col.align === 'right'
                                ? 'text-right'
                                : col.align === 'center'
                                  ? 'text-center font-medium'
                                  : 'text-left'
                            }
                          >
                            {String(hit[col.key] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span>
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {binsRows.length > 0 && (
        <Card>
          <CardHeader className="space-y-0 pb-3">
            <CardTitle className="text-base">Dispersion — {nodeLabel}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ConcordanceDispersionSummary
              rows={dispersionRows}
              textColumn={dispersionTextColumn}
              binCount={20}
              lowercaseMatches={false}
              splitBySource={false}
              allMatchedTexts={allMatchedTexts}
              matchedTextColors={{}}
              hiddenMatchedTexts={new Set()}
              dataBlockLabel={nodeLabel}
              searchWord={searchTerm}
              materialisedBins={binsRows}
              materialised={materialised}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

/** Snapshot-mode renderer for concordance results. Hosted by
 * ConcordanceFeature when ``viewMode === 'demoSnapshot'``; the live
 * UI (parameter panel + results panel) is hidden, this component
 * owns the read-only view of the captured rows + dispersion bins.
 * Plan §5.1 (Loader section) + plan §3.4 (client-side pagination).
 */
export const ConcordanceSnapshotResults: React.FC<
  ConcordanceSnapshotResultsProps
> = ({ manifest, payload }) => {
  const nodeIds = manifest.source.node_ids;
  const nodeLabelByIndex = manifest.source.node_labels;
  const searchTerm =
    manifest.preview.tool === 'concordance' ? manifest.preview.searchTerm : '';

  // Build per-node dispersion rows once. The dispersion summary
  // re-renders on bin-count change purely from these + the
  // server-captured 100-bucket bins (re-aggregated client-side via
  // buildDispersionBinsFromBinned — see concordanceViewModels:182).
  const dispersionRowsByNodeId = useMemo(() => {
    const out: Record<string, ConcordanceDispersionRow[]> = {};
    for (const [id, entry] of Object.entries(payload.resultByNodeId)) {
      out[id] = buildDispersionRows(entry.data ?? []);
    }
    return out;
  }, [payload.resultByNodeId]);

  // The "text column" used by the dispersion-bar engine to derive
  // doc lengths. The captured bins already encode the bin idx, so
  // when materialised bins are present this argument is essentially
  // only used by buildDispersionBins (fallback path) — we feed a
  // dummy column name and let materialisedBins drive the chart.
  const dispersionTextColumn = 'CONC_extraction';

  if (nodeIds.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Snapshot has no data blocks recorded.
        </CardContent>
      </Card>
    );
  }

  const firstNodeId = nodeIds[0]!;

  return (
    <Tabs defaultValue={firstNodeId} className="w-full">
      <TabsList className="flex-wrap h-auto">
        {nodeIds.map((id, idx) => (
          <TabsTrigger key={id} value={id}>
            {nodeLabelByIndex[idx] ?? id}
          </TabsTrigger>
        ))}
      </TabsList>
      {nodeIds.map((id, idx) => {
        const entry = payload.resultByNodeId[id];
        const binsResp = payload.binsByNodeId[id];
        if (!entry) {
          return (
            <TabsContent key={id} value={id}>
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  No result data captured for this data block.
                </CardContent>
              </Card>
            </TabsContent>
          );
        }
        return (
          <TabsContent key={id} value={id}>
            <NodeResultTab
              nodeId={id}
              nodeLabel={nodeLabelByIndex[idx] ?? id}
              entry={entry}
              dispersionRows={dispersionRowsByNodeId[id] ?? []}
              dispersionTextColumn={dispersionTextColumn}
              searchTerm={searchTerm}
              binsRows={(binsResp?.rows ?? []) as import('../concordanceViewModels').TaggedBinRow[]}
              materialised={Boolean(entry.materialized)}
            />
          </TabsContent>
        );
      })}
    </Tabs>
  );
};
