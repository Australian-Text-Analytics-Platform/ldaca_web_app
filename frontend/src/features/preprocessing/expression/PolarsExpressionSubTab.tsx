import React from 'react';
import { Code2, Loader2, Play, Plus, Trash2 } from 'lucide-react';

import { CodeEditor } from '../../../components/CodeEditor';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Checkbox } from '../../../components/ui/checkbox';
import { Label } from '../../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { PreviewTable } from '../components/PreviewTable';
import { usePolarsExpressionSubTab, type PolarsExpressionSubTabProps } from './hooks/usePolarsExpressionSubTab';

export type { PolarsExpressionSubTabProps } from './hooks/usePolarsExpressionSubTab';

const CONTEXT_LABELS: Record<string, string> = {
  filter: 'Filter',
  with_columns: 'With Columns',
  select: 'Select',
  sort: 'Sort',
  group_by_agg: 'Group By',
};

const CodeHint: React.FC<{ context: string }> = ({ context }) => {
  const hints: Record<string, string> = {
    filter: 'A boolean Polars expression.\nExample: pl.col("age") > 18',
    with_columns:
      'One or more expressions per box (comma-separated).\nAlias syntax: pl.col("price").mul(0.9).alias("discounted")\nAssignment syntax: discounted = pl.col("price").mul(0.9)',
    select:
      'Column references or expressions. Comma-separate multiple in one box.\nExample: pl.col("id"), pl.col("name")\nAssignment: full_name = pl.col("first") + pl.col("last")',
    sort:
      'Sort key expression(s). Set descending per item.\nExample: pl.col("date")',
    group_by_agg:
      'Grouping key and aggregation expressions.\nExample key: pl.col("category")\nAssignment: total = pl.col("sales").sum()',
  };
  return (
    <p className="rounded border border-border/40 bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">
      {hints[context] ?? ''}
    </p>
  );
};

export const PolarsExpressionSubTab: React.FC<PolarsExpressionSubTabProps> = (props) => {
  const { isLoading } = props;
  const {
    effectiveNode,
    nodeColors,
    activeContext,
    setActiveContext,
    newNodeName,
    setNewNodeName,
    isApplying,
    evalError,
    serializedRequest,

    filterCode,
    setFilterCode,
    withColumnsCodes,
    setWithColumnsCodes,
    selectCodes,
    setSelectCodes,
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
  const canApply = canEval && !!serializedRequest && !isApplying;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Code2 className="h-5 w-5" />
            Polars Expression
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Write Polars expressions in Python. They are validated and executed on the server.
          </p>
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
            showShape
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
                onBlur={evalExpressions}
                disabled={!hasNode}
                placeholder='pl.col("column_name") > 0'
                minHeight="5rem"
              />
            </TabsContent>

            {/* With Columns */}
            <TabsContent value="with_columns" className="space-y-2">
              <CodeHint context="with_columns" />
              {withColumnsCodes.map((code, i) => (
                <div key={i} className="flex gap-2">
                  <CodeEditor
                    className="flex-1"
                    value={code}
                    onChange={(val) => {
                      const next = [...withColumnsCodes];
                      next[i] = val;
                      setWithColumnsCodes(next);
                    }}
                    onBlur={evalExpressions}
                    disabled={!hasNode}
                    placeholder='b = pl.col("a").cast(pl.Utf8)'
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 shrink-0"
                    disabled={withColumnsCodes.length <= 1}
                    onClick={() => setWithColumnsCodes(withColumnsCodes.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWithColumnsCodes([...withColumnsCodes, ''])}
                disabled={!hasNode}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add expression
              </Button>
            </TabsContent>

            {/* Select */}
            <TabsContent value="select" className="space-y-2">
              <CodeHint context="select" />
              {selectCodes.map((code, i) => (
                <div key={i} className="flex gap-2">
                  <CodeEditor
                    className="flex-1"
                    value={code}
                    onChange={(val) => {
                      const next = [...selectCodes];
                      next[i] = val;
                      setSelectCodes(next);
                    }}
                    onBlur={evalExpressions}
                    disabled={!hasNode}
                    placeholder='pl.col("a"), pl.col("b")'
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 shrink-0"
                    disabled={selectCodes.length <= 1}
                    onClick={() => setSelectCodes(selectCodes.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectCodes([...selectCodes, ''])}
                disabled={!hasNode}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add expression
              </Button>
            </TabsContent>

            {/* Sort */}
            <TabsContent value="sort" className="space-y-2">
              <CodeHint context="sort" />
              {sortItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <CodeEditor
                    className="flex-1"
                    value={item.code}
                    onChange={(val) => {
                      const next = [...sortItems];
                      next[i] = { ...next[i]!, code: val };
                      setSortItems(next);
                    }}
                    onBlur={evalExpressions}
                    disabled={!hasNode}
                    placeholder='pl.col("date")'
                  />
                  <div className="flex flex-col items-center gap-1 pt-2">
                    <Label htmlFor={`sort-desc-${i}`} className="text-xs text-muted-foreground">Desc</Label>
                    <Checkbox
                      id={`sort-desc-${i}`}
                      checked={item.descending}
                      onCheckedChange={(checked) => {
                        const next = [...sortItems];
                        next[i] = { ...next[i]!, descending: Boolean(checked) };
                        setSortItems(next);
                      }}
                      disabled={!hasNode}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 shrink-0"
                    disabled={sortItems.length <= 1}
                    onClick={() => setSortItems(sortItems.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortItems([...sortItems, { code: '', descending: false }])}
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
                  onBlur={evalExpressions}
                  disabled={!hasNode}
                  placeholder='pl.col("category")'
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Aggregation expressions</Label>
                {groupByState.aggCodes.map((code, i) => (
                  <div key={i} className="flex gap-2">
                    <CodeEditor
                      className="flex-1"
                      value={code}
                      onChange={(val) => {
                        const next = [...groupByState.aggCodes];
                        next[i] = val;
                        setGroupByState({ ...groupByState, aggCodes: next });
                      }}
                      onBlur={evalExpressions}
                      disabled={!hasNode}
                      placeholder='total = pl.col("value").sum()'
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-1 shrink-0"
                      disabled={groupByState.aggCodes.length <= 1}
                      onClick={() =>
                        setGroupByState({
                          ...groupByState,
                          aggCodes: groupByState.aggCodes.filter((_, idx) => idx !== i),
                        })
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
                    setGroupByState({ ...groupByState, aggCodes: [...groupByState.aggCodes, ''] })
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
            <Button
              variant="outline"
              size="sm"
              onClick={evalExpressions}
              disabled={!canEval}
            >
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

          {/* Preview */}
          <PreviewTable
            title="Preview"
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
        </CardContent>

        <CardFooter className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Input
            className="max-w-55"
            placeholder="New block name (optional)"
            value={newNodeName}
            onChange={(e) => setNewNodeName(e.target.value)}
            disabled={!canApply}
          />
          <Button
            onClick={applyExpression}
            disabled={!canApply || isLoading.operations}
          >
            {isApplying && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Apply
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};
