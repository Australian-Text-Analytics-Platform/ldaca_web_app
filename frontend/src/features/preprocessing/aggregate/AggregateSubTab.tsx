import React from 'react';
import { Calculator, Lightbulb, Loader2 } from 'lucide-react';

import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import HelpIcon from '../../../components/help/HelpIcon';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Separator } from '../../../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { cn } from '../../../lib/utils';
import { useAggregateSubTab, type AggregateSubTabProps } from './hooks/useAggregateSubTab';

export type { AggregateSubTabProps } from './hooks/useAggregateSubTab';

export const AggregateSubTab: React.FC<AggregateSubTabProps> = (props) => {
  const { isLoading } = props;
  const {
    nodeSelection,
    expression,
    basicBuilder,
    preview,
    apply,
    manualExpressionActive,
    dropZoneRef,
  } = useAggregateSubTab(props);

  const renderPreview = () => {
    if (preview.loading) {
      return (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Calculating preview…
        </div>
      );
    }

    if (preview.error) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {preview.error}
        </div>
      );
    }

    if (!preview.data) {
      return (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-4 text-sm text-muted-foreground">
          Configure an expression and exit the field to see the computed column preview inline before applying.
        </div>
      );
    }

    const columns = preview.data.columns;
    const rows = preview.data.data;

    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col}
                    className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="px-3 py-6 text-center text-sm text-muted-foreground"
                  >
                    No rows produced by this expression.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow key={idx}>
                    {columns.map((col) => (
                      <TableCell key={`${idx}-${col}`} className="px-3 py-2 font-mono text-xs text-foreground">
                        {String(row?.[col] ?? '')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Computed Column Builder
            <HelpIcon
              targetKey="preprocessing.aggregate.tab"
              label="Aggregate sub-tab overview"
              tooltip="Combine existing columns with Polars-style expressions. The result is added to the selected node using with_columns."
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <NodeSelectionPanel
            selectedNodes={nodeSelection.effectiveNodes}
            nodeColumnSelections={nodeSelection.nodeColumnSelections}
            onColumnChange={() => undefined}
            nodeColors={nodeSelection.nodeColors}
            onColorChange={() => undefined}
            defaultPalette={nodeSelection.defaultPalette}
            maxCompare={1}
            className="rounded-lg border border-border/60 bg-muted/40 pt-0"
            showColorPicker={false}
            showColumnPicker={false}
            originalCount={nodeSelection.originalCount}
            disabled={isLoading.operations}
            showShape
            headerAddon={
              <HelpIcon
                targetKey="preprocessing.common.node-selection"
                label="Selected data tables"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          <Separator />

          <Tabs value={expression.mode} onValueChange={(val) => expression.setMode(val as 'basic' | 'advanced')} className="space-y-4">
            <TabsList className="flex max-w-md gap-2">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4">
              <div className="rounded-md border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100">
                <div className="flex items-start gap-2">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">How it works</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>Drag column bubbles into the builder to add them to the equation.</li>
                      <li>Add the Custom Text bubble for operators or literals, then click it to edit.</li>
                      <li>
                        The builder concatenates tokens with <code>+</code> automatically, quoting custom text.
                      </li>
                      <li>Reorder any bubble by dragging it before or after an existing one.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Available tokens</span>
                {basicBuilder.availableColumns.length > 0 ? (
                  <div className={cn('flex flex-wrap gap-2', basicBuilder.disabled && 'pointer-events-none opacity-60')}>
                    {basicBuilder.availableColumns.map((column) => (
                      <button
                        key={column}
                        type="button"
                        draggable={!basicBuilder.disabled}
                        onDragStart={(event) => basicBuilder.handlers.columnDragStart(event, column)}
                        onDragEnd={basicBuilder.handlers.paletteDragEnd}
                        onClick={() => basicBuilder.addColumnToken(column)}
                        className={cn(
                          'select-none rounded-full border border-border bg-foreground px-3 py-1 text-sm text-background shadow-sm transition',
                          basicBuilder.disabled
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-grab active:cursor-grabbing',
                        )}
                      >
                        {column}
                      </button>
                    ))}
                    <button
                      type="button"
                      draggable={!basicBuilder.disabled}
                      onDragStart={basicBuilder.handlers.customDragStart}
                      onDragEnd={basicBuilder.handlers.paletteDragEnd}
                      onClick={() => basicBuilder.addCustomToken()}
                      className={cn(
                        'select-none rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground shadow-sm transition',
                        basicBuilder.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing',
                      )}
                    >
                      Custom Text
                    </button>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    Column names will appear here once schema metadata loads.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">Builder</span>
                  <HelpIcon targetKey="preprocessing.aggregate.builder" label="Expression builder" />
                </div>
                <div
                  ref={dropZoneRef}
                  onDragEnter={basicBuilder.handlers.builderDragOver}
                  onDragOver={basicBuilder.handlers.builderDragOver}
                  onDragLeave={basicBuilder.handlers.builderDragLeave}
                  onDrop={basicBuilder.handlers.builderDrop}
                  className={cn(
                    'min-h-23 rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 p-4 transition',
                    basicBuilder.dragActive && 'border-primary bg-primary/5',
                    basicBuilder.disabled && 'pointer-events-none opacity-60',
                  )}
                >
                  {basicBuilder.tokens.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {manualExpressionActive ? (
                        <>
                          Expression currently defined via Advanced editor:&nbsp;
                          <code className="rounded bg-background px-2 py-1 font-mono text-xs text-foreground">
                            {expression.expression.trim()}
                          </code>
                        </>
                      ) : (
                        'Drag columns or custom text here to build an expression. Tokens snap into place as you drop them.'
                      )}
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      {basicBuilder.tokens.map((token) => {
                        const isCustom = token.kind === 'custom';
                        const isEditing = basicBuilder.editingTokenId === token.id;
                        const showBefore =
                          basicBuilder.dropIndicator?.tokenId === token.id &&
                          basicBuilder.dropIndicator.position === 'before';
                        const showAfter =
                          basicBuilder.dropIndicator?.tokenId === token.id &&
                          basicBuilder.dropIndicator.position === 'after';
                        return (
                          <div key={token.id} className="flex items-center gap-1">
                            {showBefore && <span className="h-8 w-0.5 rounded bg-primary" aria-hidden="true" />}
                            <div
                              className={cn('group relative flex items-center', basicBuilder.disabled && 'opacity-70')}
                              draggable={!basicBuilder.disabled && !isEditing}
                              onDragStart={(event) => basicBuilder.handlers.existingTokenDragStart(event, token.id)}
                              onDragEnd={basicBuilder.handlers.existingTokenDragEnd}
                              onDragOver={(event) => basicBuilder.handlers.tokenDragOver(token.id, event)}
                            >
                              <div
                                className={cn(
                                  'flex min-h-8.5 items-center gap-2 rounded-full border border-border bg-foreground px-3 py-1 text-sm text-background shadow-sm transition',
                                  !basicBuilder.disabled && !isEditing && 'cursor-grab active:cursor-grabbing',
                                )}
                              >
                                {isCustom ? (
                                  isEditing ? (
                                    <Input
                                      value={basicBuilder.customDraft}
                                      onChange={basicBuilder.handlers.customDraftChange}
                                      onBlur={() => basicBuilder.finishCustomEdit(true)}
                                      onKeyDown={basicBuilder.handlers.customInputKeyDown}
                                      spellCheck={false}
                                      autoCorrect="off"
                                      autoCapitalize="none"
                                      autoComplete="off"
                                      autoFocus
                                      className="h-7 w-32 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground shadow-none focus-visible:ring-0"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => basicBuilder.startEditingCustom(token.id)}
                                      className="text-sm font-medium tracking-tight text-background transition hover:text-background/80"
                                    >
                                      {token.value || '""'}
                                    </button>
                                  )
                                ) : (
                                  <span className="font-medium">{token.column}</span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => basicBuilder.removeToken(token.id)}
                                className="absolute -top-1.5 -right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground opacity-0 transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                                aria-label="Remove token"
                                disabled={basicBuilder.disabled}
                                onMouseDown={(event) => event.stopPropagation()}
                              >
                                <span aria-hidden="true">x</span>
                              </button>
                            </div>
                            {showAfter && <span className="h-8 w-0.5 rounded bg-primary" aria-hidden="true" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Expression preview</span>
                <div className="rounded-md border border-muted-foreground/50 bg-muted/30 px-3 py-2 font-mono text-sm text-muted-foreground">
                  {basicBuilder.expressionPreview.length > 0 ? basicBuilder.expressionPreview : '—'}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={basicBuilder.clearBuilder}
                  disabled={
                    basicBuilder.disabled ||
                    (basicBuilder.tokens.length === 0 && expression.expression.trim().length === 0)
                  }
                >
                  Clear Builder
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4">
              <div className="rounded-md border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100">
                <div className="flex items-start gap-2">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">Expression tips</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>Use column names directly (`A`) or wrap spaced names in quotes (`&quot;Total Count&quot;`).</li>
                      <li>
                        Combine with helpers like `abs()`, `round(value, 2)`, `when(condition, then, otherwise)`,
                        `coalesce(a, b)`.
                      </li>
                      <li>
                        Call `lit(&quot;value&quot;)` to force a literal string when it matches an existing column name.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <label className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  Expression
                  <HelpIcon targetKey="preprocessing.aggregate.expression" label="Advanced expression" />
                </span>
                <textarea
                  value={expression.expression}
                  onChange={expression.onChange.expression}
                  onBlur={expression.onExpressionBlur}
                  onFocus={expression.onExpressionFocus}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  autoComplete="off"
                  rows={3}
                  placeholder="Examples: A + B, when(A > 0, A, 0), A / lit(100)"
                  className={cn(
                    'w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  disabled={!nodeSelection.effectiveNodes.length || isLoading.operations}
                />
              </label>
            </TabsContent>
          </Tabs>

          <div className="space-y-4">
            <label className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                New column name (optional)
                <HelpIcon targetKey="preprocessing.aggregate.column-name" label="Computed column name" />
              </span>
              <Input
                value={expression.columnName}
                onChange={expression.onChange.columnName}
                onBlur={expression.onColumnNameBlur}
                onFocus={expression.onColumnNameFocus}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                autoComplete="off"
                placeholder="Defaults to the expression string"
                disabled={!nodeSelection.effectiveNodes.length || isLoading.operations}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Button type="button" onClick={apply.handleApply} disabled={!apply.canApply}>
                {apply.loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  'Add to Node'
                )}
              </Button>
              <HelpIcon targetKey="preprocessing.common.apply-button" label="Apply action" />
            </div>
            {(preview.loading ||
              expression.focused.expression ||
              expression.focused.columnName ||
              basicBuilder.editingTokenId !== null ||
              basicBuilder.dragActive) && (
              <span className="text-sm text-muted-foreground">
                Preview updates after you finish editing tokens or exit the fields.
              </span>
            )}
            {preview.stale &&
              !preview.loading &&
              !expression.focused.expression &&
              !expression.focused.columnName &&
              basicBuilder.editingTokenId === null &&
              !basicBuilder.dragActive && (
                <span className="text-sm text-muted-foreground">
                  Preview is out of date; it will refresh automatically.
                </span>
              )}
            {apply.currentMatchesApplied && !preview.loading && !preview.error && (
              <span className="text-sm text-muted-foreground">Latest expression already applied.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Preview
            <HelpIcon
              targetKey="preprocessing.common.preview"
              label="Preview table"
              tooltip={`Shows up to ${preview.limit} rows with the computed column appended. Preview refreshes after each apply.`}
            />
          </CardTitle>
        </CardHeader>
        <CardContent>{renderPreview()}</CardContent>
      </Card>
    </div>
  );
};
