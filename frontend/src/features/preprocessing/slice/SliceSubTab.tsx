import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import HelpIcon from '../../../components/help/HelpIcon';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Tag } from '../../../components/ui/tag';
import { PreviewTable } from '../components/PreviewTable';
import { useSliceSubTab, type SliceSubTabProps } from './hooks/useSliceSubTab';

export type { SliceSubTabProps } from './hooks/useSliceSubTab';

export const SliceSubTab: React.FC<SliceSubTabProps> = (props) => {
  const {
    selectionPanel,
    form,
    summaries,
    inlineError,
    hasSelection,
    isBusy,
    applyDisabled,
    applySlice,
    preview,
    showActivityTag,
  } = useSliceSubTab(props);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Slice rows
                <HelpIcon
                  targetKey="preprocessing.slice.tab"
                  label="Slice sub-tab overview"
                  tooltip="Extract a contiguous range of rows from the selected node."
                />
              </CardTitle>
              
            </div>
            {showActivityTag && (
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
            disabled={selectionPanel.disabled}
            originalCount={selectionPanel.originalCount}
            headerAddon={
              <HelpIcon
                targetKey="preprocessing.common.node-selection"
                label="Selected nodes"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="slice-offset">Offset</Label>
                <HelpIcon targetKey="preprocessing.slice.offset" label="Slice offset" />
              </div>
              <Input
                id="slice-offset"
                type="number"
                min={0}
                value={form.offsetInput}
                onChange={(event) => form.setOffsetInput(event.target.value)}
                disabled={!hasSelection}
              />
              <p className="text-xs text-muted-foreground">Zero-based index of the first row to include.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="slice-length">Length (optional)</Label>
                <HelpIcon targetKey="preprocessing.slice.length" label="Slice length" />
              </div>
              <Input
                id="slice-length"
                type="number"
                min={0}
                value={form.lengthInput}
                onChange={(event) => form.setLengthInput(event.target.value)}
                disabled={!hasSelection}
                placeholder="Leave blank to slice until the end"
              />
              <p className="text-xs text-muted-foreground">Number of rows to include. Leave blank to read through the end.</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="slice-new-node-name">New node name</Label>
              <HelpIcon targetKey="preprocessing.slice.new-node-name" label="Slice output name" />
            </div>
            <Input
              id="slice-new-node-name"
              type="text"
              value={form.newNodeName}
              onChange={(event) => form.setNewNodeName(event.target.value)}
              placeholder="Enter name for sliced data"
              disabled={!hasSelection}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t border-border bg-muted/20 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <p>{summaries.range}</p>
            <p>{summaries.lastResult}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {inlineError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{inlineError}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={applySlice} disabled={applyDisabled} className="w-full sm:w-auto">
                {isBusy ? 'Adding to workspace…' : 'Add to Workspace'}
              </Button>
              <HelpIcon targetKey="preprocessing.common.apply-button" label="Apply action" />
            </div>
          </div>
        </CardFooter>
      </Card>

      <PreviewTable
        title={
          <span className="flex items-center gap-2">
            Preview sliced rows
            <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
          </span>
        }
        description="Review rows returned by the current slice configuration before adding to the workspace."
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

export default SliceSubTab;
