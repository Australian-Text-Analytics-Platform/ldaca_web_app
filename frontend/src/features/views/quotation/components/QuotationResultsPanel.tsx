import { Loader2 } from 'lucide-react';

import HelpIcon from '@/components/help/HelpIcon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { GroupedResultsPageSizeSummary } from '@/features/views/common/components/GroupedResultsPageSizeSummary';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '@/features/views/common/constants';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { QuotationResultState } from '../hooks/useQuotationResultControls';
import {
  buildQuotationDisplayColumns,
  buildQuotationMetadataColumns,
  filterQuotationRowsWithQuotes,
  type QuotationResultRow,
  resolveQuotationMetadataColumns,
} from '../quotationResultsModel';
import { MAX_CONTEXT_LENGTH } from '../quotationTextClip';
import { type QuotationHoverState } from './QuotationHighlightedCell';
import { QuotationNodeBlock } from './QuotationNodeBlock';

interface QuotationResultsPanelProps {
  title?: string;
  headerAction?: React.ReactNode;
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
  onSort: (nodeId: string, columnName: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRowClick: (row: QuotationResultRow) => void;
  isPageLoading: boolean;
}

/**
 * Renders the Quotation results card, metadata/context controls, and per-node
 * result tables.
 * Rendered by: QuotationFeature after task orchestration has loaded results so
 * the feature shell can stay focused on lifecycle and request wiring.
 * Flow: derive available metadata columns from the active result, render shared
 * result controls, then render each selected node through QuotationNodeBlock
 * with pagination and sorting wired back to
 * the feature hooks.
 */
export function QuotationResultsPanel({
  title = 'Search Results',
  headerAction,
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
  onSort,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  isPageLoading,
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {title}
            <HelpIcon
              targetKey="analysis.quotation.results"
              label="Quotation results"
              tooltip="Review extracted quotations, toggle metadata, and adjust context length."
            />
          </CardTitle>
          {headerAction}
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
          return (
            <QuotationNodeBlock
              key={nodeId}
              nodeId={nodeId}
              textCol={textCol}
              cols={cols}
              sortableColumns={resultState?.metadata.metadata_columns ?? []}
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
                onRowClick(row);
              }}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
              pageSizeSummary={
                <GroupedResultsPageSizeSummary
                  groups={resultState?.groupedRows ?? []}
                  totalProcessed={resultState?.pagination.page_size}
                />
              }
              loading={isPageLoading}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
