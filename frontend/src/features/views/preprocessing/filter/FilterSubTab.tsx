import type { ReactNode } from 'react';
import { Filter, Loader2, Plus } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import HelpIcon from '@/components/help/HelpIcon';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { ConditionBuilder } from '../components/condition-builder';
import { PreviewTable } from '../components/PreviewTable';
import { SubTabActivityTag } from '../components/SubTabActivityTag';
import { acceptPlaceholderOnTab } from '@/features/views/common/placeholderTabFill';
import { useFilterSubTabSections, type FilterSubTabProps } from './hooks/useFilterSubTabSections';
import type { FilterConditionWithId } from '../types';

type FilterSubTabComponentProps = FilterSubTabProps & {
  renderNodeInputsPanel?: () => ReactNode;
};

/**
 * Renders the Filter preprocessing tab. It relies on `useFilterSubTabSections`
 * for condition state, categorical options, preview data, and apply behavior.
 * Rendered by: useFilterSubTabSections hook, DataPreprocessingFeature module, SubTabActivityTag component (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: read grouped configs from the hook, render selection/condition/preview panels, and send
 * condition edits/apply requests through hook actions.
 */
export function FilterSubTab(props: FilterSubTabComponentProps) {
  const { renderNodeInputsPanel } = props;
  const {
    schemaState,
    conditionBuilder,
    newNodeInput,
    isFiltering,
    applyFilter,
    applyButtonDisabled,
    applyButtonDisabledReason,
    preview,
  } = useFilterSubTabSections(props);

  const { hasSelection, hasSchema } = schemaState;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filter Data
                <HelpIcon
                  targetKey="preprocessing.filter.tab"
                  label="Filter sub-tab overview"
                  tooltip="Apply column-based filters to create a new data block from the selected data block."
                />
              </CardTitle>
            </div>
            <SubTabActivityTag active={isFiltering} verb="Running" />
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {renderNodeInputsPanel?.()}

          {hasSelection && !hasSchema && (
            <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
              No schema information is available for this data block yet.
            </div>
          )}

          <ConditionBuilder<FilterConditionWithId>
            title={
              <span className="flex items-center gap-2">
                Filter conditions
                <HelpIcon
                  targetKey="preprocessing.filter.conditions"
                  label="Filter conditions builder"
                />
              </span>
            }
            description="Apply column-based filters to create a new data block from the selected data block."
            conditions={conditionBuilder.conditions}
            availableColumns={conditionBuilder.availableColumns}
            logic={conditionBuilder.logic}
            onLogicChange={conditionBuilder.setLogic}
            onAddCondition={conditionBuilder.onAddCondition}
            onRemoveCondition={conditionBuilder.onRemoveCondition}
            onConditionChange={conditionBuilder.onConditionChange}
            disabled={schemaState.isConfigDisabled}
            hasSelection={hasSelection}
            noSelectionMessage="Configure conditions once a data block is selected."
            noSchemaMessage="No schema information is available for this data block yet."
            renderValueInput={conditionBuilder.renderValueInput}
            renderConditionMetadata={conditionBuilder.renderConditionMetadata}
            shouldHideOperatorSelect={conditionBuilder.shouldHideOperatorSelect}
            getOperatorOptions={conditionBuilder.getOperatorOptions}
            getColumnHintId={(_condition, index) =>
              index === 0 ? 'preprocessing.filter.condition-column' : undefined
            }
          />
        </CardContent>

        <CardFooter className="flex items-center gap-3 border-t border-border bg-muted/20 py-4">
          <div className="flex flex-1 items-center gap-2">
            <label
              className="shrink-0 text-sm font-medium text-muted-foreground"
              htmlFor="filter-new-node-name"
            >
              New data block name
            </label>
            <HelpIcon targetKey="preprocessing.filter.new-node-name" label="Filter output name" />
            <input
              id="filter-new-node-name"
              type="text"
              value={newNodeInput.value}
              onChange={(event) => {
                newNodeInput.setValue(event.target.value);
              }}
              onKeyDown={(event) => {
                acceptPlaceholderOnTab({
                  event,
                  value: newNodeInput.value,
                  setValue: newNodeInput.setValue,
                });
              }}
              placeholder={newNodeInput.placeholder}
              disabled={newNodeInput.disabled}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <DisabledReasonTooltip reason={applyButtonDisabledReason}>
            <Button
              size="sm"
              onClick={() => {
                void applyFilter();
              }}
              disabled={applyButtonDisabled}
              className="shrink-0"
            >
              {isFiltering ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding to workspace…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Workspace
                </>
              )}
            </Button>
          </DisabledReasonTooltip>
          <HelpIcon targetKey="preprocessing.common.apply-button" label="Apply action" />
        </CardFooter>
      </Card>

      <PreviewTable
        title={
          <span className="flex items-center gap-2">
            Preview filtered results
            <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
          </span>
        }
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
        documentColumn={props.selectedNode?.document ?? undefined}
        onPageSizeChange={preview.onPageSizeChange}
        onPageChange={preview.onPageChange}
      />
    </div>
  );
}
