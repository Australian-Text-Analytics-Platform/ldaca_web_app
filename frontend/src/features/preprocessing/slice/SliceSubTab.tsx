import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import HelpIcon from '../../../components/help/HelpIcon';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tag } from '../../../components/ui/tag';
import { PreviewTable } from '../components/PreviewTable';
import { getNodeDocumentColumn } from '../utils/nodeMetadata';
import { acceptPlaceholderOnTab } from '../utils/placeholderTabFill';
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
                Sample rows
                <HelpIcon
                  targetKey="preprocessing.slice.tab"
                  label="Sample sub-tab overview"
                  tooltip="Create either a contiguous slice or a random sample from the selected data block."
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
                label="Selected data blocks"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          <div className="space-y-2">
            <Label htmlFor="sampling-mode">Sampling method</Label>
            <Select value={form.mode} onValueChange={(value) => form.setMode(value as 'slice' | 'random_sample')}>
              <SelectTrigger id="sampling-mode" disabled={!hasSelection} className="sm:max-w-xs">
                <SelectValue placeholder="Select sampling method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slice">Slice</SelectItem>
                <SelectItem value="random_sample">Random Sample</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.mode === 'slice' ? (
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
                  <Label htmlFor="slice-length">Length</Label>
                  <HelpIcon targetKey="preprocessing.slice.length" label="Slice length" />
                </div>
                <Input
                  id="slice-length"
                  type="number"
                  min={0}
                  value={form.lengthInput}
                  onChange={(event) => form.setLengthInput(event.target.value)}
                  disabled={!hasSelection}
                  placeholder="Number of rows to include"
                />
                <p className="text-xs text-muted-foreground">Number of rows to include from the offset.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sample-fraction">Fraction / Count</Label>
                <Input
                  id="sample-fraction"
                  type="number"
                  min={0}
                  step="any"
                  value={form.sampleSizeInput}
                  onChange={(event) => form.setSampleSizeInput(event.target.value)}
                  disabled={!hasSelection}
                  placeholder="e.g. 0.4 for 40% or 100 for 100 rows"
                />
                <p className="text-xs text-muted-foreground">Fraction (0–1) for proportional sampling, or an integer ≥ 1 for an absolute row count.</p>
                {form.sampleSizeHint && (
                  <p className="text-xs text-destructive">{form.sampleSizeHint}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="sample-random-seed">Random seed</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="sample-random-seed"
                    type="number"
                    min={0}
                    step="1"
                    value={form.randomSeedInput}
                    onChange={(event) => form.setRandomSeedInput(event.target.value)}
                    disabled={!hasSelection || form.noRandomSeed}
                    placeholder={form.noRandomSeed ? 'No seed' : 'Seed'}
                    className="w-28"
                  />
                  <Checkbox
                    id="no-random-seed"
                    checked={form.noRandomSeed}
                    onCheckedChange={(checked) => form.setNoRandomSeed(checked === true)}
                    disabled={!hasSelection}
                  />
                  <Label htmlFor="no-random-seed" className="text-sm font-normal text-muted-foreground whitespace-nowrap">
                    No Random Seed
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">Use a seed to reproduce the same sampled rows.</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="slice-new-node-name">New data block name</Label>
              <HelpIcon targetKey="preprocessing.slice.new-node-name" label="Sample output name" />
            </div>
            <Input
              id="slice-new-node-name"
              type="text"
              value={form.newNodeName}
              onChange={(event) => form.setNewNodeName(event.target.value)}
              onKeyDown={(event) => acceptPlaceholderOnTab({ event, value: form.newNodeName, setValue: form.setNewNodeName })}
              placeholder={form.newNodeNamePlaceholder}
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
            Preview output rows
            <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
          </span>
        }
        description="Review rows returned by the current slice or random sample configuration before adding to the workspace."
        columns={preview.columns}
        data={preview.data}
        pagination={preview.pagination}
        loading={preview.loading}
        error={preview.error}
        ready={preview.ready}
        readyMessage={preview.readyMessage}
        page={preview.page}
        pageSize={preview.pageSize}
        documentColumn={getNodeDocumentColumn(props.selectedNode)}
        onPageSizeChange={preview.onPageSizeChange}
        onPreviousPage={preview.onPreviousPage}
        onNextPage={preview.onNextPage}
      />
    </div>
  );
};

export default SliceSubTab;
