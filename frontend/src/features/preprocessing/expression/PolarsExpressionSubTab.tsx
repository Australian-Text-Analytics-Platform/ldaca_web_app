import { Code2, Loader2, Play, Plus, Trash2 } from 'lucide-react';

import { CodeEditor } from '@/features/preprocessing/expression/CodeEditor';
import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
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
import { acceptPlaceholderOnTab } from '../utils/placeholderTabFill';
import {
  usePolarsExpressionSubTab,
  blankExpression,
  blankSortExpression,
  type PolarsExpressionSubTabProps,
} from './hooks/usePolarsExpressionSubTab';

export type { PolarsExpressionSubTabProps } from './hooks/usePolarsExpressionSubTab';

const CONTEXT_LABELS: Record<string, string> = {
  filter: 'Filter',
  with_columns: 'With Columns',
  select: 'Select',
  sort: 'Sort',
  group_by_agg: 'Group By',
};

/**
 * Shows context-specific expression examples next to each CodeEditor. The
 * Polars expression tab uses it to keep backend syntax hints near the active
 * context without hard-coding them into every tab panel.
 * Rendered by: preprocessing/PolarsExpressionSubTab module JSX because the parent needs this component boundary to keep feature controls and state presentation isolated.
 */
function CodeHint({ context }: { context: string }) {
  const hints: Record<string, string> = {
    filter: 'A boolean Polars expression.\nExample: pl.col("age") > 18',
    with_columns:
      'One or more expressions per box (comma-separated).\nAlias syntax: pl.col("price").mul(0.9).alias("discounted")\nAssignment syntax: discounted = pl.col("price").mul(0.9)',
    select:
      'Column references or expressions. Comma-separate multiple in one box.\nExample: pl.col("id"), pl.col("name")\nAssignment: full_name = pl.col("first") + pl.col("last")',
    sort: 'Sort key expression(s). Set descending per item.\nExample: pl.col("date")',
    group_by_agg:
      'Grouping key and aggregation expressions.\nExample key: pl.col("category")\nAssignment: total = pl.col("sales").sum()',
  };
  return (
    <p className="rounded border border-border/40 bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">
      {hints[context] ?? ''}
    </p>
  );
}

/**
 * Renders the general Polars-expression preprocessing tab. It delegates request
 * serialization, preview, and apply behavior to `usePolarsExpressionSubTab`.
 * Rendered by: DataPreprocessingFeature module, CodeEditor module, PreviewTable component (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: manage expression tabs and shared context, render editors/preview table, evaluate
 * expressions for preview, and apply column/sort/group operations through hook actions.
 */
export function PolarsExpressionSubTab(props: PolarsExpressionSubTabProps) {
  const { isLoading } = props;
  const {
    effectiveNode,
    nodeColors,
    activeContext,
    setActiveContext,
    newNodeName,
    newNodeNamePlaceholder,
    setNewNodeName,
    isApplying,
    evalError,
    serializedRequest,

    filterCode,
    setFilterCode,
    withColumns,
    setWithColumns,
    selectExpressions,
    setSelectExpressions,
    sortItems,
    setSortItems,
    groupByState,
    setGroupByState,

    evalExpressions,
    applyExpression,
    preview,
  } = usePolarsExpressionSubTab(props);

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
                Polars Expression
                <HelpIcon
                  targetKey="preprocessing.expression.tab"
                  label="Polars Expression sub-tab overview"
                  tooltip="Write Polars expressions in Python to transform data blocks."
                />
              </CardTitle>
            </div>
            <SubTabActivityTag active={isApplying} verb="Adding" />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Node selection */}
          <NodeSelectionPanel
            selectedNodes={effectiveNode ? [effectiveNode] : []}
            nodeColumnSelections={[]}
            onColumnChange={() => undefined}
            nodeColors={nodeColors}
            onColorChange={() => undefined}
            defaultPalette={['#2563eb']}
            maxCompare={1}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showColumnPicker={false}
            showHeaderLabel
            showShape
            headerAddon={
              <HelpIcon
                targetKey="preprocessing.common.node-selection"
                label="Selected data blocks"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          {/* Context tabs */}
          <Tabs
            value={activeContext}
            onValueChange={(v) => setActiveContext(v as typeof activeContext)}
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
              <CodeEditor
                value={filterCode}
                onChange={setFilterCode}
                onBlur={() => {
                  void evalExpressions();
                }}
                disabled={!hasNode}
                placeholder='pl.col("column_name") > 0'
                minHeight="5rem"
              />
            </TabsContent>

            {/* With Columns */}
            <TabsContent value="with_columns" className="space-y-2">
              <CodeHint context="with_columns" />
              {withColumns.map((item) => (
                <div key={item.id} className="flex gap-2">
                  <CodeEditor
                    className="flex-1"
                    value={item.code}
                    onChange={(val) => {
                      setWithColumns((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, code: val } : it)),
                      );
                    }}
                    onBlur={() => {
                  void evalExpressions();
                }}
                    disabled={!hasNode}
                    placeholder='b = pl.col("a").cast(pl.Utf8)'
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 shrink-0"
                    disabled={withColumns.length <= 1}
                    onClick={() => setWithColumns((prev) => prev.filter((it) => it.id !== item.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWithColumns((prev) => [...prev, blankExpression()])}
                disabled={!hasNode}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add expression
              </Button>
            </TabsContent>

            {/* Select */}
            <TabsContent value="select" className="space-y-2">
              <CodeHint context="select" />
              {selectExpressions.map((item) => (
                <div key={item.id} className="flex gap-2">
                  <CodeEditor
                    className="flex-1"
                    value={item.code}
                    onChange={(val) => {
                      setSelectExpressions((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, code: val } : it)),
                      );
                    }}
                    onBlur={() => {
                  void evalExpressions();
                }}
                    disabled={!hasNode}
                    placeholder='pl.col("a"), pl.col("b")'
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 shrink-0"
                    disabled={selectExpressions.length <= 1}
                    onClick={() =>
                      setSelectExpressions((prev) => prev.filter((it) => it.id !== item.id))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectExpressions((prev) => [...prev, blankExpression()])}
                disabled={!hasNode}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add expression
              </Button>
            </TabsContent>

            {/* Sort */}
            <TabsContent value="sort" className="space-y-2">
              <CodeHint context="sort" />
              {sortItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2">
                  <CodeEditor
                    className="flex-1"
                    value={item.code}
                    onChange={(val) => {
                      setSortItems((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, code: val } : it)),
                      );
                    }}
                    onBlur={() => {
                  void evalExpressions();
                }}
                    disabled={!hasNode}
                    placeholder='pl.col("date")'
                  />
                  <div className="flex flex-col items-center gap-1 pt-2">
                    <Label
                      htmlFor={`sort-desc-${item.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Desc
                    </Label>
                    <Checkbox
                      id={`sort-desc-${item.id}`}
                      checked={item.descending}
                      onCheckedChange={(checked) => {
                        setSortItems((prev) =>
                          prev.map((it) =>
                            it.id === item.id ? { ...it, descending: Boolean(checked) } : it,
                          ),
                        );
                      }}
                      disabled={!hasNode}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 shrink-0"
                    disabled={sortItems.length <= 1}
                    onClick={() => setSortItems((prev) => prev.filter((it) => it.id !== item.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortItems((prev) => [...prev, blankSortExpression()])}
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
                <Label className="text-xs font-medium">Grouping key expression</Label>
                <CodeEditor
                  value={groupByState.keyCode}
                  onChange={(val) => setGroupByState({ ...groupByState, keyCode: val })}
                  onBlur={() => {
                  void evalExpressions();
                }}
                  disabled={!hasNode}
                  placeholder='pl.col("category")'
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Aggregation expressions</Label>
                {groupByState.aggExpressions.map((item) => (
                  <div key={item.id} className="flex gap-2">
                    <CodeEditor
                      className="flex-1"
                      value={item.code}
                      onChange={(val) => {
                        setGroupByState((prev) => ({
                          ...prev,
                          aggExpressions: prev.aggExpressions.map((it) =>
                            it.id === item.id ? { ...it, code: val } : it,
                          ),
                        }));
                      }}
                      onBlur={() => {
                  void evalExpressions();
                }}
                      disabled={!hasNode}
                      placeholder='total = pl.col("value").sum()'
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-1 shrink-0"
                      disabled={groupByState.aggExpressions.length <= 1}
                      onClick={() =>
                        setGroupByState((prev) => ({
                          ...prev,
                          aggExpressions: prev.aggExpressions.filter((it) => it.id !== item.id),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setGroupByState((prev) => ({
                      ...prev,
                      aggExpressions: [...prev.aggExpressions, blankExpression()],
                    }))
                  }
                  disabled={!hasNode}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add aggregation
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* Eval button + error */}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => {
              void evalExpressions();
            }} disabled={!canEval}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Preview
            </Button>
            {serializedRequest && !evalError && (
              <span className="text-xs text-green-700">
                ✓ {serializedRequest.expressions.length} expression(s) ready
              </span>
            )}
          </div>

          {evalError && (
            <div className="rounded border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-800 whitespace-pre-wrap">
              {evalError}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex items-center gap-3 border-t pt-4">
          <div className="flex flex-1 items-center gap-2">
            <Label htmlFor="polars-new-node-name" className="shrink-0">
              New data block name
            </Label>
            <Input
              id="polars-new-node-name"
              className="min-w-0 flex-1"
              placeholder={newNodeNamePlaceholder}
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              onKeyDown={(event) =>
                acceptPlaceholderOnTab({ event, value: newNodeName, setValue: setNewNodeName })
              }
              disabled={!canApply}
            />
          </div>
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
