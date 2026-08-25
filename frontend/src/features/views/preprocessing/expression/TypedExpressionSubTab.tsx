import type { ReactNode } from 'react';
import { Code2, Loader2, Play, Plus, Trash2 } from 'lucide-react';

import { TypedExpressionEditor } from './TypedExpressionEditor';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { PreviewTable } from '../components/PreviewTable';
import { SubTabActivityTag } from '../components/SubTabActivityTag';
import { acceptPlaceholderOnTab } from '@/features/views/common/placeholderTabFill';
import {
  useTypedExpressionSubTab,
  type TypedExpressionSubTabProps,
} from './hooks/useTypedExpressionSubTab';

type TypedExpressionSubTabComponentProps = TypedExpressionSubTabProps & {
  renderNodeInputsPanel?: () => ReactNode;
};

const CONTEXT_LABELS: Record<string, string> = {
  filter: 'Filter',
  with_columns: 'With Columns',
  select: 'Select',
  sort: 'Sort',
  group_by_agg: 'Group By',
};

/**
 * Shows examples for the generated typed-expression contract.
 * Rendered by `TypedExpressionSubTab` to switch among expression editors.
 */
function CodeHint({ context }: { context: string }) {
  const hints: Record<string, string> = {
    filter:
      'One typed expression item as JSON.\nExample: {"expression":{"op":"gt","left":{"op":"column","name":"age"},"right":{"op":"literal","value":18}}}',
    with_columns:
      'One typed expression item per box. Use alias for the output column.\nExample: {"expression":{"op":"multiply","left":{"op":"column","name":"price"},"right":{"op":"literal","value":0.9}},"alias":"discounted"}',
    select:
      'One typed expression item per selected output.\nExample: {"expression":{"op":"column","name":"id"}}',
    sort: 'One typed expression item per sort key. Set descending separately.\nExample: {"expression":{"op":"column","name":"date"}}',
    group_by_agg:
      'Use typed items for the grouping key and aggregations.\nExample aggregation: {"expression":{"op":"sum","operand":{"op":"column","name":"sales"}},"alias":"total"}',
  };
  return (
    <p className="rounded-sm border border-surface-border/40 bg-panel/50 p-2 font-mono text-[11px] text-description whitespace-pre-wrap">
      {hints[context] ?? ''}
    </p>
  );
}

interface ExpressionListEditorProps {
  items: { id: string; source: string }[];
  placeholder: string;
  addLabel: string;
  disabled: boolean;
  onBlur: () => void;
  onSourceChange: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

/**
 * Renders the repeated "one or more Polars expressions" editor pattern.
 * Rendered by: TypedExpressionSubTab for With Columns, Select, and Group By
 * aggregation lists so those contexts share add/remove/editor chrome.
 */
function ExpressionListEditor({
  items,
  placeholder,
  addLabel,
  disabled,
  onBlur,
  onSourceChange,
  onRemove,
  onAdd,
}: ExpressionListEditorProps) {
  return (
    <>
      {items.map((item) => (
        <div key={item.id} className="flex gap-2">
          <TypedExpressionEditor
            className="flex-1"
            value={item.source}
            onChange={(value) => {
              onSourceChange(item.id, value);
            }}
            onBlur={onBlur}
            disabled={disabled}
            placeholder={placeholder}
          />
          <Button
            variant="ghost"
            size="icon"
            className="mt-1 shrink-0"
            disabled={items.length <= 1}
            onClick={() => {
              onRemove(item.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </>
  );
}

/**
 * Renders the generated typed-expression preprocessing tab. It delegates request
 * serialization, preview, and apply behavior to `useTypedExpressionSubTab`.
 * Rendered by `DataPreprocessingFeature`; it composes the typed editor and `PreviewTable`.
 * Flow: manage expression tabs and shared context, render editors/preview table, evaluate
 * expressions for preview, and apply column/sort/group operations through hook actions.
 */
export function TypedExpressionSubTab(props: TypedExpressionSubTabComponentProps) {
  const { applyMode, isLoading } = props;
  const { renderNodeInputsPanel } = props;
  const {
    effectiveNode,
    activeContext,
    setActiveContext,
    newNodeName,
    newNodeNamePlaceholder,
    setNewNodeName,
    isApplying,
    evalError,
    serializedRequest,

    filterSource,
    setFilterSource,
    withColumns,
    selectExpressions,
    sortItems,
    groupByState,
    updateExpressionSource,
    addExpression,
    removeExpression,
    setGroupByKeySource,
    updateSortSource,
    updateSortDescending,
    addSortExpression,
    removeSortExpression,

    evalExpressions,
    applyExpression,
    preview,
  } = useTypedExpressionSubTab(props);

  const hasNode = !!effectiveNode;
  const canEval = hasNode;
  const canApply = canEval && !!serializedRequest && !isApplying && !preview.error;

  const applyDisabledReason: string | undefined = (() => {
    if (isApplying || isLoading.operations) return undefined;
    if (!hasNode) return 'Select a data block first';
    if (!serializedRequest) return 'Build and preview an expression first';
    if (preview.error)
      return 'Fix the expression error shown in Preview before adding to workspace';
    return undefined;
  })();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-5 w-5" />
                Expression
                <HelpIcon
                  targetKey="preprocessing.expression.tab"
                  label="Expression sub-tab overview"
                  tooltip="Build typed expressions that the backend validates before transforming data blocks."
                />
              </CardTitle>
            </div>
            <SubTabActivityTag active={isApplying} verb="Adding" />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {renderNodeInputsPanel?.()}

          {/* Context tabs */}
          <Tabs
            value={activeContext}
            onValueChange={(v) => {
              setActiveContext(v as typeof activeContext);
            }}
            className="space-y-3"
          >
            <TabsList className="flex flex-wrap gap-1">
              {Object.entries(CONTEXT_LABELS).map(([key, label]) => (
                <TabsTrigger key={key} value={key} disabled={!hasNode}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Filter */}
            <TabsContent value="filter" className="space-y-2">
              <CodeHint context="filter" />
              <TypedExpressionEditor
                value={filterSource}
                onChange={setFilterSource}
                onBlur={() => {
                  evalExpressions();
                }}
                disabled={!hasNode}
                placeholder='{"expression":{"op":"is_not_null","operand":{"op":"column","name":"column_name"}}}'
                minHeight="5rem"
              />
            </TabsContent>

            {/* With Columns */}
            <TabsContent value="with_columns" className="space-y-2">
              <CodeHint context="with_columns" />
              <ExpressionListEditor
                items={withColumns}
                placeholder='{"expression":{"op":"cast","operand":{"op":"column","name":"a"},"dtype":"string"},"alias":"b"}'
                addLabel="Add expression"
                disabled={!hasNode}
                onBlur={evalExpressions}
                onSourceChange={(id, value) => {
                  updateExpressionSource('withColumns', id, value);
                }}
                onRemove={(id) => {
                  removeExpression('withColumns', id);
                }}
                onAdd={() => {
                  addExpression('withColumns');
                }}
              />
            </TabsContent>

            {/* Select */}
            <TabsContent value="select" className="space-y-2">
              <CodeHint context="select" />
              <ExpressionListEditor
                items={selectExpressions}
                placeholder='{"expression":{"op":"column","name":"a"}}'
                addLabel="Add expression"
                disabled={!hasNode}
                onBlur={evalExpressions}
                onSourceChange={(id, value) => {
                  updateExpressionSource('selectExpressions', id, value);
                }}
                onRemove={(id) => {
                  removeExpression('selectExpressions', id);
                }}
                onAdd={() => {
                  addExpression('selectExpressions');
                }}
              />
            </TabsContent>

            {/* Sort */}
            <TabsContent value="sort" className="space-y-2">
              <CodeHint context="sort" />
              {sortItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2">
                  <TypedExpressionEditor
                    className="flex-1"
                    value={item.source}
                    onChange={(val) => {
                      updateSortSource(item.id, val);
                    }}
                    onBlur={() => {
                      evalExpressions();
                    }}
                    disabled={!hasNode}
                    placeholder='{"expression":{"op":"column","name":"date"}}'
                  />
                  <div className="flex flex-col items-center gap-1 pt-2">
                    <Label
                      htmlFor={`sort-desc-${item.id}`}
                      className="text-label-secondary text-description"
                    >
                      Desc
                    </Label>
                    <Checkbox
                      id={`sort-desc-${item.id}`}
                      checked={item.descending}
                      onCheckedChange={(checked) => {
                        updateSortDescending(item.id, Boolean(checked));
                      }}
                      disabled={!hasNode}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 shrink-0"
                    disabled={sortItems.length <= 1}
                    onClick={() => {
                      removeSortExpression(item.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  addSortExpression();
                }}
                disabled={!hasNode}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add sort key
              </Button>
            </TabsContent>

            {/* Group By Agg */}
            <TabsContent value="group_by_agg" className="space-y-3">
              <CodeHint context="group_by_agg" />
              <div className="space-y-1">
                <Label className="text-label-secondary font-medium">Grouping key expression</Label>
                <TypedExpressionEditor
                  value={groupByState.keySource}
                  onChange={(val) => {
                    setGroupByKeySource(val);
                  }}
                  onBlur={() => {
                    evalExpressions();
                  }}
                  disabled={!hasNode}
                  placeholder='{"expression":{"op":"column","name":"category"}}'
                />
              </div>
              <div className="space-y-1">
                <Label className="text-label-secondary font-medium">Aggregation expressions</Label>
                <ExpressionListEditor
                  items={groupByState.aggExpressions}
                  placeholder='{"expression":{"op":"sum","operand":{"op":"column","name":"value"}},"alias":"total"}'
                  addLabel="Add aggregation"
                  disabled={!hasNode}
                  onBlur={evalExpressions}
                  onSourceChange={(id, value) => {
                    updateExpressionSource('groupByAgg', id, value);
                  }}
                  onRemove={(id) => {
                    removeExpression('groupByAgg', id);
                  }}
                  onAdd={() => {
                    addExpression('groupByAgg');
                  }}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Eval button + error */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                evalExpressions();
              }}
              disabled={!canEval}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Preview
            </Button>
            {serializedRequest && !evalError && (
              <span className="text-label-secondary text-[var(--vscode-charts-green)]">
                ✓ {serializedRequest.expressions.length} expression(s) ready
              </span>
            )}
          </div>

          {evalError && (
            <div className="rounded-sm border border-error bg-error-background p-3 font-mono text-label-secondary text-error whitespace-pre-wrap">
              {evalError}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex items-center gap-3 border-t pt-4">
          {applyMode === 'create' && (
            <div className="flex flex-1 items-center gap-2">
              <Label htmlFor="polars-new-node-name" className="shrink-0">
                New data block name
              </Label>
              <Input
                id="polars-new-node-name"
                className="min-w-0 flex-1"
                placeholder={newNodeNamePlaceholder}
                value={newNodeName}
                onChange={(e) => {
                  setNewNodeName(e.target.value);
                }}
                onKeyDown={(event) => {
                  acceptPlaceholderOnTab({ event, value: newNodeName, setValue: setNewNodeName });
                }}
                disabled={!canApply}
              />
            </div>
          )}
          <DisabledReasonTooltip reason={applyDisabledReason}>
            <Button
              size="sm"
              onClick={() => {
                void applyExpression();
              }}
              disabled={!canApply || isLoading.operations}
              className="shrink-0"
            >
              {isApplying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {applyMode === 'create' ? 'Creating Data Block…' : 'Updating Data Block…'}
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  {applyMode === 'create' ? 'Create Data Block' : 'Update Data Block'}
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
            Preview
            <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
          </span>
        }
        description="Result of expression applied to the selected data block"
        columns={preview.columns}
        data={preview.data}
        pagination={preview.pagination}
        loading={preview.loading}
        error={preview.error}
        ready={preview.ready}
        readyMessage="Evaluate an expression to see a preview"
        page={preview.page}
        pageSize={preview.pageSize}
        onPageSizeChange={preview.setPageSize}
        onPageChange={preview.setPage}
      />
    </div>
  );
}
