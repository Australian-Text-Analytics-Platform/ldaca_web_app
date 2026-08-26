import type { ReactNode } from 'react';
import { Calculator, Loader2, X } from 'lucide-react';

import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { cn } from '@/lib/utils';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import { PreviewTable } from '../components/PreviewTable';
import { PreprocessingApplyBar } from '../components/PreprocessingApplyBar';
import { SubTabActivityTag } from '../components/SubTabActivityTag';
import { OperationPopover } from './components/OperationPopover';
import { useAggregateSubTab, type AggregateSubTabProps } from './hooks/useAggregateSubTab';

type AggregateSubTabComponentProps = AggregateSubTabProps & {
  renderNodeInputsPanel?: () => ReactNode;
  onApplyModeChange: (value: AggregateSubTabProps['applyMode']) => void;
};

/**
 * Entry component for the computed-column builder. It exists to key the inner
 * content by selection so builder state resets when the active source changes.
 * Rendered by: DataPreprocessingFeature module.
 */
export function AggregateSubTab(props: AggregateSubTabComponentProps) {
  return <AggregateSubTabContent key={getAggregateSelectionKey(props)} {...props} />;
}

/**
 * Derives the reset key for the aggregate builder from the most recent source
 * node. Only `AggregateSubTab` uses it to remount the content on selection
 * changes.
 * Called by `AggregateSubTab` to key its state-owning content component.
 */
const getAggregateSelectionKey = (props: AggregateSubTabComponentProps): string => {
  const [selectedNode] = takeMostRecent(props.selectedNodes, 1);
  if (selectedNode) {
    return selectedNode.id;
  }
  return 'none';
};

/**
 * Renders the computed-column builder UI. It consumes `useAggregateSubTab` so
 * layout remains separate from expression/token state and apply/preview logic.
 * Rendered by `AggregateSubTab` with a key that resets state on selection changes.
 * Flow: split hook config into selection/builder/preview/apply props, render expression and
 * visual-builder modes, and keep table/apply controls tied to hook state.
 */
function AggregateSubTabContent(props: AggregateSubTabComponentProps) {
  const { applyMode, isLoading, onApplyModeChange } = props;
  const { renderNodeInputsPanel } = props;
  const { activeNode, expression, basicBuilder, preview, apply, dropZoneRef } =
    useAggregateSubTab(props);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Computed Column Builder
                <HelpIcon
                  targetKey="preprocessing.aggregate.tab"
                  label="Aggregate sub-tab overview"
                  tooltip="Combine existing columns with Polars-style expressions. The result is added to the selected data block using with_columns."
                />
              </CardTitle>
            </div>
            <SubTabActivityTag active={apply.loading} verb="Adding" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderNodeInputsPanel?.()}

          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-body font-medium text-foreground">Available columns</span>
              {basicBuilder.availableColumns.length > 0 ? (
                <div
                  className={cn(
                    'flex flex-wrap gap-2',
                    basicBuilder.disabled && 'pointer-events-none opacity-60',
                  )}
                >
                  {basicBuilder.availableColumns.map((col) => (
                    <button
                      key={col.name}
                      type="button"
                      draggable={!basicBuilder.disabled}
                      onDragStart={(event) => {
                        basicBuilder.handlers.columnDragStart(event, col.name, col.typeName);
                      }}
                      onDragEnd={basicBuilder.handlers.paletteDragEnd}
                      onClick={() => {
                        basicBuilder.addColumnToken(col.name, col.typeName);
                      }}
                      className={cn(
                        'select-none rounded-full border border-surface-border bg-foreground px-3 py-1 text-body text-editor transition',
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
                    onClick={() => {
                      basicBuilder.addCustomToken();
                    }}
                    className={cn(
                      'select-none rounded-full border border-surface-border bg-editor px-3 py-1 text-body text-foreground transition',
                      basicBuilder.disabled
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-grab active:cursor-grabbing',
                    )}
                  >
                    Custom Text
                  </button>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-surface-border-foreground/50 bg-panel/30 px-3 py-2 text-body text-description">
                  Column names will appear here once schema metadata loads.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-body font-medium text-foreground">Builder</span>
                <HelpIcon targetKey="preprocessing.aggregate.builder" label="Expression builder" />
              </div>
              <div
                ref={dropZoneRef}
                onDragEnter={basicBuilder.handlers.builderDragOver}
                onDragOver={basicBuilder.handlers.builderDragOver}
                onDragLeave={basicBuilder.handlers.builderDragLeave}
                onDrop={basicBuilder.handlers.builderDrop}
                className={cn(
                  'min-h-23 rounded-md border border-dashed border-surface-border-foreground/50 bg-panel/30 p-4 transition',
                  basicBuilder.dragActive && 'border-button bg-button/5',
                  basicBuilder.disabled && 'pointer-events-none opacity-60',
                )}
              >
                {basicBuilder.tokens.length === 0 ? (
                  <p className="text-body text-description">
                    Drag columns or custom text here to build an expression. Tokens snap into place
                    as you drop them.
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
                          {showBefore && (
                            <span className="h-8 w-0.5 rounded-sm bg-button" aria-hidden="true" />
                          )}
                          <div
                            className={cn('group', basicBuilder.disabled && 'opacity-70')}
                            draggable={!basicBuilder.disabled && !isEditing}
                            onDragStart={(event) => {
                              basicBuilder.handlers.existingTokenDragStart(event, token.id);
                            }}
                            onDragEnd={basicBuilder.handlers.existingTokenDragEnd}
                            onDragOver={(event) => {
                              basicBuilder.handlers.tokenDragOver(token.id, event);
                            }}
                          >
                            <div
                              className={cn(
                                'flex min-h-8.5 items-center gap-1 rounded-full border border-surface-border bg-foreground px-3 py-1 text-body text-editor transition',
                                !basicBuilder.disabled &&
                                  !isEditing &&
                                  'cursor-grab active:cursor-grabbing',
                              )}
                            >
                              {isCustom ? (
                                isEditing ? (
                                  <Input
                                    value={basicBuilder.customDraft}
                                    onChange={basicBuilder.handlers.customDraftChange}
                                    onBlur={() => {
                                      basicBuilder.finishCustomEdit(true);
                                    }}
                                    onKeyDown={basicBuilder.handlers.customInputKeyDown}
                                    spellCheck={false}
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    autoComplete="off"
                                    autoFocus
                                    className="h-7 w-32 rounded-md border border-surface-border bg-editor px-2 py-1 text-body text-foreground shadow-none focus-visible:ring-0"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      basicBuilder.startEditingCustom(token.id);
                                    }}
                                    className="text-body font-medium tracking-tight text-editor transition hover:text-editor/80"
                                  >
                                    {token.value || '""'}
                                  </button>
                                )
                              ) : (
                                <OperationPopover
                                  workspaceId={props.currentWorkspaceId}
                                  nodeId={activeNode?.id ?? ''}
                                  column={token.column}
                                  onSelect={(op) => {
                                    basicBuilder.addOperation(token.id, op);
                                  }}
                                  disabled={basicBuilder.disabled}
                                >
                                  <button
                                    type="button"
                                    className="font-medium hover:text-editor/80 transition"
                                  >
                                    {token.column}
                                  </button>
                                </OperationPopover>
                              )}
                              {!isCustom &&
                                token.operations.map((op, idx) => (
                                  <span
                                    key={`${op}-${String(idx)}`}
                                    className="flex items-center gap-0.5 border-l border-editor/30 pl-1"
                                  >
                                    <span className="font-mono text-label-secondary text-editor/70">
                                      .{op}()
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        basicBuilder.removeOperation(token.id, idx);
                                      }}
                                      className="inline-flex size-3.5 items-center justify-center rounded-full hover:bg-editor/20 focus-visible:outline-hidden"
                                      aria-label={`Remove ${op}`}
                                      disabled={basicBuilder.disabled}
                                    >
                                      <X className="size-2.5" />
                                    </button>
                                  </span>
                                ))}
                              <button
                                type="button"
                                onClick={() => {
                                  basicBuilder.removeToken(token.id);
                                }}
                                className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-editor/30 text-editor/60 transition hover:border-editor/60 hover:text-editor focus-visible:outline-hidden group-hover:border-editor/60 group-hover:text-editor"
                                aria-label="Remove token"
                                disabled={basicBuilder.disabled}
                                onMouseDown={(event) => {
                                  event.stopPropagation();
                                }}
                              >
                                <X className="size-2.5" />
                              </button>
                            </div>
                          </div>
                          {showAfter && (
                            <span className="h-8 w-0.5 rounded-sm bg-button" aria-hidden="true" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-body font-medium text-foreground">Expression preview</span>
              <div className="rounded-md border border-surface-border-foreground/50 bg-panel/30 px-3 py-2 font-mono text-body text-description break-all">
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
        </CardContent>

        <PreprocessingApplyBar value={applyMode} onChange={onApplyModeChange}>
          <div className="flex flex-1 items-center gap-2">
            <span className="shrink-0 text-body font-medium text-foreground">New column name</span>
            <HelpIcon
              targetKey="preprocessing.aggregate.column-name"
              label="Computed column name"
            />
            <Input
              value={expression.columnName}
              onChange={expression.onChange.columnName}
              onBlur={expression.onColumnNameBlur}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              autoComplete="off"
              placeholder="new_column"
              disabled={!activeNode || isLoading.operations}
              className="min-w-0 flex-1"
            />
          </div>
          <DisabledReasonTooltip reason={apply.disabledReason}>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void apply.handleApply();
              }}
              disabled={!apply.canApply}
              className="shrink-0"
            >
              {apply.loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {applyMode === 'create' ? 'Creating Data Block…' : 'Updating Data Block…'}
                </>
              ) : applyMode === 'create' ? (
                'Create Data Block'
              ) : (
                'Update Data Block'
              )}
            </Button>
          </DisabledReasonTooltip>
          <HelpIcon targetKey="preprocessing.common.apply-button" label="Apply action" />
        </PreprocessingApplyBar>
      </Card>

      <PreviewTable
        title={
          <span className="flex items-center gap-2">
            Preview
            <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
          </span>
        }
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
        documentColumn={activeNode?.document ?? undefined}
        onPageSizeChange={preview.setPageSize}
        onPageChange={preview.onPageChange}
      />
    </div>
  );
}
