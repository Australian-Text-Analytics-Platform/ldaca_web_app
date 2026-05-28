import React from 'react';
import { Layers, Loader2, Plus } from 'lucide-react';

import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { PreviewTable } from '../components/PreviewTable';
import { SubTabActivityTag } from '../components/SubTabActivityTag';
import { acceptPlaceholderOnTab } from '../utils/placeholderTabFill';
import { useConcatSubTab, type ConcatSubTabProps } from './hooks/useConcatSubTab';

export type { ConcatSubTabProps } from './hooks/useConcatSubTab';

/**
 * Renders the Concatenate preprocessing sub-tab. It consumes `useConcatSubTab`
 * so schema analysis, preview fetching, and apply behavior stay out of the
 * JSX layout.
 * Rendered by: DataPreprocessingFeature module, SubTabActivityTag component, useConcatSubTab hook (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: collect selected nodes/schema analysis from its hook, render node ordering and mismatch
 * guidance, preview concatenation results, then expose apply controls.
 */
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
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Concatenate Datasets
                <HelpIcon
                  targetKey="preprocessing.concat.tab"
                  label="Concat sub-tab overview"
                  tooltip="Stack compatible data blocks vertically into a single data block."
                />
              </CardTitle>
            </div>
            <SubTabActivityTag active={showActivityTag} verb="Concatenating" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
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

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Schema status</Label>
              <HelpIcon targetKey="preprocessing.concat.schema-status" label="Schema status" />
            </div>
            <div className="rounded-md border border-muted-foreground/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {statusMessage}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="concat-deduplicate"
              checked={form.deduplicate}
              onCheckedChange={(checked) => form.setDeduplicate(checked === true)}
            />
            <span>Drop duplicate rows after stacking</span>
            <HelpIcon
              targetKey="preprocessing.concat.deduplicate"
              label="Deduplicate stacked rows"
              tooltip="Run polars .unique() across all columns so identical rows from different inputs collapse into one."
            />
          </label>
        </CardContent>
        <CardFooter className="flex items-center gap-3 border-t pt-4">
          <div className="flex flex-1 items-center gap-2">
            <Label htmlFor="concat-new-node-name" className="shrink-0">New data block name</Label>
            <HelpIcon targetKey="preprocessing.concat.new-node-name" label="Concat output name" />
            <Input
              id="concat-new-node-name"
              value={form.value}
              placeholder={form.placeholder}
              onChange={(event) => form.setValue(event.target.value)}
              onKeyDown={(event) => acceptPlaceholderOnTab({ event, value: form.value, setValue: form.setValue })}
              className="min-w-0 flex-1"
            />
          </div>
          <DisabledReasonTooltip reason={apply.disabledReason}>
            <Button type="button" size="sm" onClick={() => void apply.run()} disabled={apply.disabled} className="shrink-0">
              {apply.isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Concatenating…
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
        onPageChange={preview.onPageChange}
      />
    </div>
  );
};

export default ConcatSubTab;
