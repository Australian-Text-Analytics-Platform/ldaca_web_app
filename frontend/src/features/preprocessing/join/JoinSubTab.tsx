import React from 'react';
import { Loader2 } from 'lucide-react';

import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import HelpIcon from '../../../components/help/HelpIcon';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tag } from '../../../components/ui/tag';
import { PreviewTable } from '../components/PreviewTable';
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
    joinStatusMessage,
    preview,
    apply,
    showActivityTag,
  } = useJoinSubTab(props);

  const previewBadge = preview.loading ? (
    <Tag tone="muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading preview…
    </Tag>
  ) : showActivityTag ? (
    <Tag tone="muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Working…
    </Tag>
  ) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="flex items-center gap-2">
            Configure join
            <HelpIcon
              targetKey="preprocessing.join.tab"
              label="Join sub-tab overview"
              tooltip="Combine up to two nodes using matching columns."
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <p className="text-sm text-muted-foreground">
            Select up to two nodes in the workspace (Shift/⌘-click) to configure a join. Column pickers will appear below
            for the current selection.
            <span className="ml-2 inline-flex items-center">
              <HelpIcon
                targetKey="preprocessing.join.column"
                label="Join column picker"
                className="h-5 w-5 text-muted-foreground"
              />
            </span>
          </p>

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
                label="Selected data tables"
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
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="join-new-node-name">New node name</Label>
                <HelpIcon targetKey="preprocessing.join.new-node-name" label="Join output name" />
              </div>
              <Input
                id="join-new-node-name"
                value={joinNewNodeName}
                placeholder={joinNamePlaceholder}
                onChange={(event) => setJoinNewNodeName(event.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the suggested name shown in gray.</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">{joinStatusMessage}</div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={apply.run} disabled={apply.disabled}>
              {apply.isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining…
                </>
              ) : (
                'Add to Workspace'
              )}
            </Button>
            <HelpIcon targetKey="preprocessing.common.apply-button" label="Apply action" />
          </div>
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
          description="Inspect a sample of the joined rows before creating the node."
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
          loadingBadge={previewBadge}
        />
      </div>
    </div>
  );
};
