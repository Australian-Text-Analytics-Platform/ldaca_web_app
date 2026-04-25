import React from 'react';
import { Calculator, Loader2, X } from 'lucide-react';

import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import HelpIcon from '../../../components/help/HelpIcon';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Separator } from '../../../components/ui/separator';
import { cn } from '../../../lib/utils';
import { PreviewTable } from '../components/PreviewTable';
import { getNodeDocumentColumn } from '../utils/nodeMetadata';
import { OperationPopover } from './components/OperationPopover';
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
    dropZoneRef,
  } = useAggregateSubTab(props);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Computed Column Builder
            <HelpIcon
              targetKey="preprocessing.aggregate.tab"
              label="Aggregate sub-tab overview"
              tooltip="Combine existing columns with Polars-style expressions. The result is added to the selected data block using with_columns."
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
                label="Selected data blocks"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          <Separator />

          <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Available columns</span>
                {basicBuilder.availableColumns.length > 0 ? (
                  <div className={cn('flex flex-wrap gap-2', basicBuilder.disabled && 'pointer-events-none opacity-60')}>
                    {basicBuilder.availableColumns.map((col) => (
                      <button
                        key={col.name}
                        type="button"
                        draggable={!basicBuilder.disabled}
                        onDragStart={(event) => basicBuilder.handlers.columnDragStart(event, col.name, col.dataType)}
                        onDragEnd={basicBuilder.handlers.paletteDragEnd}
                        onClick={() => basicBuilder.addColumnToken(col.name, col.dataType)}
                        className={cn(
                          'select-none rounded-full border border-border bg-foreground px-3 py-1 text-sm text-background shadow-sm transition',
                          basicBuilder.disabled
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-grab active:cursor-grabbing',
                        )}
                      >
                        {col.name}
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
                      Drag columns or custom text here to build an expression. Tokens snap into place as you drop them.
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
                              className={cn('group', basicBuilder.disabled && 'opacity-70')}
                              draggable={!basicBuilder.disabled && !isEditing}
                              onDragStart={(event) => basicBuilder.handlers.existingTokenDragStart(event, token.id)}
                              onDragEnd={basicBuilder.handlers.existingTokenDragEnd}
                              onDragOver={(event) => basicBuilder.handlers.tokenDragOver(token.id, event)}
                            >
                              <div
                                className={cn(
                                  'flex min-h-8.5 items-center gap-1 rounded-full border border-border bg-foreground px-3 py-1 text-sm text-background shadow-sm transition',
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
                                  <OperationPopover
                                    nodeId={nodeSelection.effectiveNodes[0]?.id ?? nodeSelection.effectiveNodes[0]?.node_id ?? ''}
                                    column={token.column}
                                    dtype={token.dtype}
                                    onSelect={(op) => basicBuilder.addOperation(token.id, op)}
                                    disabled={basicBuilder.disabled}
                                  >
                                    <button type="button" className="font-medium hover:text-background/80 transition">
                                      {token.column}
                                    </button>
                                  </OperationPopover>
                                )}
                                {!isCustom && token.operations.map((op, idx) => (
                                  <span key={`${op}-${idx}`} className="flex items-center gap-0.5 border-l border-background/30 pl-1">
                                    <span className="font-mono text-xs text-background/70">.{op}()</span>
                                    <button
                                      type="button"
                                      onClick={() => basicBuilder.removeOperation(token.id, idx)}
                                      className="inline-flex size-3.5 items-center justify-center rounded-full hover:bg-background/20 focus-visible:outline-none"
                                      aria-label={`Remove ${op}`}
                                      disabled={basicBuilder.disabled}
                                    >
                                      <X className="size-2.5" />
                                    </button>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => basicBuilder.removeToken(token.id)}
                                  className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-background/30 text-background/60 transition hover:border-background/60 hover:text-background focus-visible:outline-none group-hover:border-background/60 group-hover:text-background"
                                  aria-label="Remove token"
                                  disabled={basicBuilder.disabled}
                                  onMouseDown={(event) => event.stopPropagation()}
                                >
                                  <X className="size-2.5" />
                                </button>
                              </div>
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
                <div className="rounded-md border border-muted-foreground/50 bg-muted/30 px-3 py-2 font-mono text-sm text-muted-foreground break-all">
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
          </div>

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
                  'Add to Data Block'
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
            {apply.currentMatchesApplied && !preview.loading && !preview.error && (
              <span className="text-sm text-muted-foreground">Latest expression already applied.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <PreviewTable
        title="Preview"
        description="Shows the computed column appended. Preview refreshes after each apply."
        columns={preview.columns}
        data={preview.data}
        pagination={preview.pagination}
        loading={preview.loading}
        error={preview.error}
        ready={preview.ready}
        readyMessage={preview.readyMessage}
        page={preview.page}
        pageSize={preview.pageSize}
        documentColumn={getNodeDocumentColumn(nodeSelection.effectiveNodes[0])}
        onPageSizeChange={preview.setPageSize}
        onPageChange={preview.onPageChange}
      />
    </div>
  );
};
