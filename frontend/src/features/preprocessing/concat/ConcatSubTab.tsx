import React from 'react';
import { Loader2 } from 'lucide-react';

import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import HelpIcon from '../../../components/help/HelpIcon';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Tag } from '../../../components/ui/tag';
import { PreviewTable } from '../components/PreviewTable';
import { acceptPlaceholderOnTab } from '../utils/placeholderTabFill';
import { useConcatSubTab, type ConcatSubTabProps } from './hooks/useConcatSubTab';

export type { ConcatSubTabProps } from './hooks/useConcatSubTab';

export const ConcatSubTab: React.FC<ConcatSubTabProps> = (props) => {
  const {
    selectionPanel,
    form,
    statusMessage,
    extraSelectionMessage,
    preview,
    apply,
    mismatches,
    showActivityTag,
  } = useConcatSubTab(props);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Concatenate datasets
                <HelpIcon
                  targetKey="preprocessing.concat.tab"
                  label="Concat sub-tab overview"
                  tooltip="Stack compatible data blocks vertically into a single data block."
                />
              </CardTitle>
            </div>
            {showActivityTag && (
              <Tag tone="muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Concatenating…
              </Tag>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <p className="text-sm text-muted-foreground">
            Multi-select data blocks in the workspace (Shift/⌘-click) to stack them vertically. We′ll align schemas and preserve column order.
          </p>

          <NodeSelectionPanel
            selectedNodes={selectionPanel.selectedNodes}
            nodeColumnSelections={selectionPanel.nodeColumnSelections}
            onColumnChange={selectionPanel.onColumnChange}
            nodeColors={selectionPanel.nodeColors}
            onColorChange={selectionPanel.onColorChange}
            defaultPalette={selectionPanel.defaultPalette}
            maxCompare={selectionPanel.maxCompare}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showColumnPicker={false}
            showHeaderLabel
            showShape
            disabled={selectionPanel.disabled}
            originalCount={selectionPanel.originalCount}
            statusMessage={selectionPanel.statusMessage || undefined}
            statusVariant={selectionPanel.statusVariant || undefined}
            headerAddon={
              <HelpIcon
                targetKey="preprocessing.common.node-selection"
                label="Selected data blocks"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          {extraSelectionMessage && (
            <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-sm text-amber-900">
              {extraSelectionMessage}
            </div>
          )}

          {mismatches.length > 0 && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="font-semibold">Schema mismatches detected:</div>
              <ul className="space-y-2">
                {mismatches.map((mismatch) => (
                  <li key={`concat-mismatch-${mismatch.nodeId}`} className="space-y-1">
                    <div className="font-medium">{mismatch.nodeName}</div>
                    {mismatch.details.map((detail, idx) => (
                      <div key={`concat-mismatch-${mismatch.nodeId}-${idx}`} className="text-destructive">
                        {detail}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="concat-new-node-name">New data block name</Label>
                <HelpIcon targetKey="preprocessing.concat.new-node-name" label="Concat output name" />
              </div>
              <Input
                id="concat-new-node-name"
                value={form.value}
                placeholder={form.placeholder}
                onChange={(event) => form.setValue(event.target.value)}
                onKeyDown={(event) => acceptPlaceholderOnTab({ event, value: form.value, setValue: form.setValue })}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the suggested name shown in gray.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Schema status</Label>
                <HelpIcon targetKey="preprocessing.concat.schema-status" label="Schema status" />
              </div>
              <div className="rounded-md border border-muted-foreground/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {statusMessage}
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">{statusMessage}</div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => void apply.run()} disabled={apply.disabled}>
              {apply.isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Concatenating…
                </>
              ) : (
                'Add to Workspace'
              )}
            </Button>
            <HelpIcon targetKey="preprocessing.common.apply-button" label="Apply action" />
          </div>
        </CardFooter>
      </Card>

      <PreviewTable
        title={
          <span className="flex items-center gap-2">
            Preview concat output
            <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
          </span>
        }
        description="Inspect a sample of the stacked rows before creating the data block."
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
        loadingBadge={preview.loading ? (
          <Tag tone="muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading preview…
          </Tag>
        ) : null}
      />
    </div>
  );
};

export default ConcatSubTab;
