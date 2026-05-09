import React from 'react';
import { Loader2, Merge, Plus } from 'lucide-react';

import NodeSelectionPanel from '@/components/NodeSelectionPanel';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { PreviewTable } from '../components/PreviewTable';
import { SubTabActivityTag } from '../components/SubTabActivityTag';
import { acceptPlaceholderOnTab } from '../utils/placeholderTabFill';
import { JOIN_TYPE_OPTIONS, type JoinType } from '../types';
import { useJoinSubTab, type JoinSubTabProps } from './hooks/useJoinSubTab';

export type { JoinSubTabProps } from './hooks/useJoinSubTab';

export const JoinSubTab: React.FC<JoinSubTabProps> = (props) => {
  const {
    selectionPanel,
    sharedColumnsNotice,
    needsColumns,
    joinType,
    setJoinType,
    currentJoinTypeInfo,
    joinNewNodeName,
    setJoinNewNodeName,
    joinNamePlaceholder,
    preview,
    apply,
    showActivityTag,
  } = useJoinSubTab(props);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Merge className="h-5 w-5" />
                Configure Join
                <HelpIcon
                  targetKey="preprocessing.join.tab"
                  label="Join sub-tab overview"
                  tooltip="Combine up to two data blocks using matching columns."
                />
              </CardTitle>
            </div>
            <SubTabActivityTag active={showActivityTag} verb="Joining" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <NodeSelectionPanel
            selectedNodes={selectionPanel.selectedNodes}
            nodeColumnSelections={selectionPanel.nodeColumnSelections}
            nodeColors={selectionPanel.nodeColors}
            onColumnChange={selectionPanel.onColumnChange}
            onColorChange={selectionPanel.onColorChange}
            getNodeColumns={selectionPanel.getNodeColumns}
            defaultPalette={selectionPanel.defaultPalette}
            maxCompare={selectionPanel.maxCompare}
            disabled={selectionPanel.disabled}
            originalCount={selectionPanel.originalCount}
            statusMessage={selectionPanel.statusMessage ?? undefined}
            columnLabelFn={selectionPanel.columnLabelFn}
            showColorPicker={false}
            showHeaderLabel
            showShape
            className="rounded-lg border border-border/60 bg-muted/40"
            headerAddon={
              <HelpIcon
                targetKey="preprocessing.common.node-selection"
                label="Selected data blocks"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          {needsColumns && sharedColumnsNotice && (
            <div className="text-xs text-muted-foreground">{sharedColumnsNotice}</div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="join-type">Join type</Label>
                <HelpIcon targetKey="preprocessing.join.join-type" label="Join type selector" />
              </div>
              <Select value={joinType} onValueChange={(value) => setJoinType(value as JoinType)}>
                <SelectTrigger id="join-type">
                  <SelectValue placeholder="Select join type" />
                </SelectTrigger>
                <SelectContent>
                  {JOIN_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentJoinTypeInfo && (
                <p className="text-xs text-muted-foreground">{currentJoinTypeInfo.description}</p>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex items-center gap-3 border-t pt-4">
          <div className="flex flex-1 items-center gap-2">
            <Label htmlFor="join-new-node-name" className="shrink-0">New data block name</Label>
            <HelpIcon targetKey="preprocessing.join.new-node-name" label="Join output name" />
            <Input
              id="join-new-node-name"
              value={joinNewNodeName}
              placeholder={joinNamePlaceholder}
              onChange={(event) => setJoinNewNodeName(event.target.value)}
              onKeyDown={(event) => acceptPlaceholderOnTab({ event, value: joinNewNodeName, setValue: setJoinNewNodeName })}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
          </div>
          <DisabledReasonTooltip reason={apply.disabledReason}>
            <Button type="button" size="sm" onClick={apply.run} disabled={apply.disabled} className="shrink-0">
              {apply.isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining…
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

      <div className="space-y-3">
        {joinType === 'cross' && preview.ready && (
          <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-xs text-amber-900">
            Cross joins can create very large outputs. The preview only displays {preview.pageSize} rows at a time.
          </div>
        )}

        <PreviewTable
          title={
            <span className="flex items-center gap-2">
              Preview join output
              <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
            </span>
          }
          description="Inspect a sample of the joined rows before creating the data block."
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
    </div>
  );
};
