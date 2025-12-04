import React from 'react';
import { Loader2 } from 'lucide-react';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Tag } from '../../../components/ui/tag';
import { Button } from '../../../components/ui/button';
import { ConditionBuilder } from '../components/condition-builder';
import { PreviewTable } from '../components/PreviewTable';
import { useFilterSubTabSections, type FilterSubTabProps } from './hooks/useFilterSubTabSections';
import type { FilterConditionWithId } from '../types';

export const FilterSubTab: React.FC<FilterSubTabProps> = (props) => {
  const {
    selectionPanel,
    schemaState,
    conditionBuilder,
    newNodeInput,
    summaryText,
    isFiltering,
    applyFilter,
    applyButtonDisabled,
    preview,
    getNodeShape,
    selectedNodesOriginalCount,
  } = useFilterSubTabSections(props);

  const { hasSelection, hasSchema, isSchemaLoading } = schemaState;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Filter data</CardTitle>
              <CardDescription>
                Apply column-based filters to create a new node from the selected dataset.
              </CardDescription>
            </div>
            {isFiltering && (
              <Tag tone="muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running…
              </Tag>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-0">
          <NodeSelectionPanel
            selectedNodes={selectionPanel.selectedNodes}
            nodeColumnSelections={selectionPanel.nodeColumnSelections}
            onColumnChange={selectionPanel.onColumnChange}
            nodeColors={selectionPanel.nodeColors}
            onColorChange={selectionPanel.onColorChange}
            defaultPalette={selectionPanel.defaultPalette}
            maxCompare={1}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showColumnPicker={false}
            showHeaderLabel
            showShape
            getNodeShapeFn={getNodeShape}
            disabled={selectionPanel.disabled}
            originalCount={selectedNodesOriginalCount}
          />

          {hasSelection && isSchemaLoading && (
            <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
              Loading column metadata…
            </div>
          )}

          {hasSelection && !isSchemaLoading && !hasSchema && (
            <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
              No schema information is available for this node yet.
            </div>
          )}

          <ConditionBuilder<FilterConditionWithId>
            title="Filter conditions"
            description="Apply column-based filters to create a new node from the selected dataset."
            conditions={conditionBuilder.conditions}
            availableColumns={conditionBuilder.availableColumns}
            logic={conditionBuilder.logic}
            onLogicChange={conditionBuilder.setLogic}
            onAddCondition={conditionBuilder.onAddCondition}
            onRemoveCondition={conditionBuilder.onRemoveCondition}
            onConditionChange={conditionBuilder.onConditionChange}
            disabled={schemaState.isConfigDisabled}
            hasSelection={hasSelection}
            isSchemaLoading={hasSelection && isSchemaLoading}
            noSelectionMessage="Configure conditions once a node is selected."
            schemaLoadingMessage="Retrieving column information…"
            noSchemaMessage="No schema information is available for this node yet."
            renderValueInput={conditionBuilder.renderValueInput}
            renderConditionMetadata={conditionBuilder.renderConditionMetadata}
            shouldHideOperatorSelect={conditionBuilder.shouldHideOperatorSelect}
            getOperatorOptions={conditionBuilder.getOperatorOptions}
          />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground" htmlFor="filter-new-node-name">
              New node name
            </label>
            <input
              id="filter-new-node-name"
              type="text"
              value={newNodeInput.value}
              onChange={(event) => newNodeInput.setValue(event.target.value)}
              placeholder="Enter name for filtered data"
              disabled={newNodeInput.disabled}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 border-t border-border bg-muted/20 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">{summaryText}</div>
          <Button onClick={applyFilter} disabled={applyButtonDisabled} className="w-full sm:w-auto">
            {isFiltering ? 'Adding to workspace…' : 'Add to Workspace'}
          </Button>
        </CardFooter>
      </Card>

      <PreviewTable
        title="Preview filtered rows"
        description="Review rows that match the current filter configuration."
        columns={preview.columns}
        data={preview.data}
        pagination={preview.pagination}
        loading={preview.loading}
        error={preview.error}
        ready={preview.ready}
        readyMessage={preview.readyMessage}
        page={preview.page}
        pageSize={preview.pageSize}
        onPageSizeChange={preview.onPageSizeChange}
        onPreviousPage={preview.onPreviousPage}
        onNextPage={preview.onNextPage}
      />
    </div>
  );
};

export default FilterSubTab;
