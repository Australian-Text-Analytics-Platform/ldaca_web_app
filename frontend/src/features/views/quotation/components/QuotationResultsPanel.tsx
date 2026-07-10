import { Loader2, Plus } from 'lucide-react';

import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Input } from '@/components/ui/input';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { GroupedResultsPageSizeSummary } from '@/features/views/common/components/GroupedResultsPageSizeSummary';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '@/features/views/common/constants';
import { MAX_CONTEXT_LENGTH } from '../quotationTextClip';
import {
  buildQuotationDisplayColumns,
  buildQuotationMetadataColumns,
  filterQuotationRowsWithQuotes,
  resolveQuotationMetadataColumns,
} from '../quotationResultsModel';
import type { MaterializeSummary, QuotationResultState } from '../hooks/useQuotationResultControls';
import { type QuotationHoverState } from './QuotationHighlightedCell';
import { QuotationNodeBlock } from './QuotationNodeBlock';

interface QuotationResultsPanelProps {
  displayedNodes: WorkspaceNodeMetadata[];
  activeSelections: NodeColumnSelection[];
  resultsByNode: Record<string, QuotationResultState>;
  selectedMetadataColumns: string[];
  onSelectedMetadataColumnsChange: (columns: string[]) => void;
  contextLength: number;
  contextLengthInput: string;
  contextLengthError: string | null;
  isSavingContextLength: boolean;
  onContextLengthInputChange: (value: string) => void;
  onContextLengthBlur: () => void;
  onContextLengthKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  hoverState: QuotationHoverState | null;
  onHoverChange: (state: QuotationHoverState | null) => void;
  materializedPaths: Record<string, string>;
  materializeSummary: MaterializeSummary | null;
  nodeMaterializing: Record<string, boolean>;
  nodeDetaching: Record<string, boolean>;
  onSort: (nodeId: string, columnName: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRowClick: (row: Record<string, unknown>, textColumn: string) => void;
  onMaterialize: (nodeId: string) => void;
  onOpenDetachDialog: (nodeId: string) => void;
}

/**
 * Renders the Quotation results card, metadata/context controls, and per-node
 * result tables.
 * Rendered by: QuotationFeature after task orchestration has loaded results so
 * the feature shell can stay focused on lifecycle and request wiring.
 * Flow: derive available metadata columns from the active result, render shared
 * result controls, then render each selected node through QuotationNodeBlock
 * with pagination, sorting, materialization, and detach actions wired back to
 * the feature hooks.
 */
export function QuotationResultsPanel({
  displayedNodes,
  activeSelections,
  resultsByNode,
  selectedMetadataColumns,
  onSelectedMetadataColumnsChange,
  contextLength,
  contextLengthInput,
  contextLengthError,
  isSavingContextLength,
  onContextLengthInputChange,
  onContextLengthBlur,
  onContextLengthKeyDown,
  hoverState,
  onHoverChange,
  materializedPaths,
  materializeSummary,
  nodeMaterializing,
  nodeDetaching,
  onSort,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  onMaterialize,
  onOpenDetachDialog,
}: QuotationResultsPanelProps) {
  const metadataNodeId = displayedNodes[0]?.id ?? '';
  const quotationMetadataColumns = buildQuotationMetadataColumns(
    metadataNodeId ? resultsByNode[metadataNodeId] : null,
  );
  const resolvedMetadataColumns = resolveQuotationMetadataColumns(
    selectedMetadataColumns,
    quotationMetadataColumns,
  );
  const showMetadata = selectedMetadataColumns.length > 0;

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            Search Results
            <HelpIcon
              targetKey="analysis.quotation.results"
              label="Quotation results"
              tooltip="Review extracted quotations, toggle metadata, and adjust context length."
            />
          </CardTitle>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <MetadataColumnSelector
              availableColumns={quotationMetadataColumns}
              selectedColumns={resolvedMetadataColumns}
              onSelectedColumnsChange={onSelectedMetadataColumnsChange}
            />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="quotation-context-length"
                  className="text-sm font-medium text-foreground"
                >
                  Context length (words per side)
                </label>
                <HelpIcon
                  targetKey="analysis.quotation.context-length"
                  label="Quotation context length"
                />
              </div>
              <Input
                id="quotation-context-length"
                aria-label="Context length in words"
                type="number"
                min={0}
                max={MAX_CONTEXT_LENGTH}
                step={1}
                value={contextLengthInput}
                onChange={(event) => {
                  onContextLengthInputChange(event.target.value);
                }}
                onBlur={onContextLengthBlur}
                onKeyDown={onContextLengthKeyDown}
                className="h-9 w-24 text-right"
                inputMode="numeric"
                disabled={isSavingContextLength}
              />
              {isSavingContextLength && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving…</span>
                </div>
              )}
            </div>
          </div>
          <span
            className={`text-xs ${contextLengthError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {contextLengthError ??
              `Enter a whole number between 0 and ${String(MAX_CONTEXT_LENGTH)}.`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        {displayedNodes.map((node) => {
          const nodeId = node.id;
          const selection = activeSelections.find((entry) => entry.nodeId === nodeId);
          const textCol = selection?.column ?? '';

          const resultState = resultsByNode[nodeId];
          const rowsWithQuotes = filterQuotationRowsWithQuotes(resultState?.rows);
          const visibleMetadataColumns = showMetadata ? resolvedMetadataColumns : [];
          const cols = buildQuotationDisplayColumns(visibleMetadataColumns);
          const materialized = Boolean(materializedPaths[nodeId]);

          return (
            <QuotationNodeBlock
              key={nodeId}
              nodeId={nodeId}
              textCol={textCol}
              cols={cols}
              rows={rowsWithQuotes}
              pagination={resultState?.pagination}
              sortBy={resultState?.sorting.sort_by}
              contextLength={contextLength}
              hoverState={hoverState}
              onHoverChange={onHoverChange}
              onSort={onSort}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              onRowClick={(row) => {
                onRowClick(row, textCol);
              }}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
              pageSizeSummary={
                materialized ? (
                  materializeSummary ? (
                    <GroupedResultsPageSizeSummary
                      groups={[]}
                      totalInstances={materializeSummary.recordCount}
                      totalDocuments={materializeSummary.uniqueDocuments}
                      totalProcessed={materializeSummary.totalDocuments}
                    />
                  ) : (
                    // Materialise summary not yet hydrated (for example, the
                    // task-request fetch is mid-flight after Process All). Fall
                    // back to the pagination total until the document
                    // breakdown lands.
                    <>
                      (Found {(resultState?.pagination.total_source_rows ?? 0).toLocaleString()}{' '}
                      {(resultState?.pagination.total_source_rows ?? 0) === 1
                        ? 'quotation'
                        : 'quotations'}{' '}
                      across the materialised corpus.)
                    </>
                  )
                ) : (
                  <GroupedResultsPageSizeSummary
                    groups={resultState?.groupedRows ?? []}
                    totalProcessed={resultState?.pagination.page_size}
                  />
                )
              }
            >
              <DisabledReasonTooltip reason={undefined}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onMaterialize(nodeId);
                  }}
                  disabled={
                    Boolean(nodeMaterializing[nodeId]) ||
                    materialized ||
                    Boolean(nodeDetaching[nodeId])
                  }
                  className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                  title="Cache all occurrence rows to disk so subsequent pagination and Add-to-Workspace reuse them"
                >
                  {nodeMaterializing[nodeId] ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing…
                    </>
                  ) : materialized ? (
                    <>Processed</>
                  ) : (
                    <>Process All</>
                  )}
                </Button>
              </DisabledReasonTooltip>
              <DisabledReasonTooltip reason={undefined}>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onOpenDetachDialog(nodeId);
                  }}
                  disabled={Boolean(nodeDetaching[nodeId])}
                  className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                >
                  {nodeDetaching[nodeId] ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adding to Workspace…
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add to Workspace
                    </>
                  )}
                </Button>
              </DisabledReasonTooltip>
            </QuotationNodeBlock>
          );
        })}
      </CardContent>
    </Card>
  );
}
