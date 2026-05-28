import React from 'react';
import { Search } from 'lucide-react';

import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { PreviewTable } from '../components/PreviewTable';
import { SubTabActivityTag } from '../components/SubTabActivityTag';
import { getNodeDocumentColumn } from '../utils/nodeMetadata';
import { acceptPlaceholderOnTab } from '../utils/placeholderTabFill';
import { useReplaceSubTab, type ReplaceSubTabProps } from './hooks/useReplaceSubTab';

export type { ReplaceSubTabProps } from './hooks/useReplaceSubTab';

/**
 * Renders the Find/Transform preprocessing tab. It delegates regex/extract
 * state, preview, and apply behavior to `useReplaceSubTab`.
 * Rendered by: DataPreprocessingFeature module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: render target column/find-replace controls, show preview output, and delegate
 * apply/preview actions to the replace hook.
 */
export const ReplaceSubTab: React.FC<ReplaceSubTabProps> = (props) => {
  const {
    activeNodeId,
    hasSelection,
    effectiveNodes,
    stringColumns,
    selectedColumn,
    setSelectedColumn,
    mode,
    setMode,
    n,
    setN,
    pattern,
    setPattern,
    replacement,
    setReplacement,
    connector,
    setConnector,
    outputColumnName,
    setOutputColumnName,
    controlsDisabled,
    canApply,
    applyDisabledReason,
    applyLoading,
    handleApply,
    nodeColors,
    defaultPalette,
    selectedNodes,
    preview,
  } = useReplaceSubTab(props);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Find &amp; Transform with Regex
                <HelpIcon
                  targetKey="preprocessing.find.tab"
                  label="Find sub-tab overview"
                  tooltip="Find regex matches in a text column and replace or extract them."
                />
              </CardTitle>
            </div>
            <SubTabActivityTag active={applyLoading} verb="Applying" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <NodeSelectionPanel
            selectedNodes={effectiveNodes}
            nodeColumnSelections={activeNodeId ? [{ nodeId: activeNodeId, column: selectedColumn }] : []}
            onColumnChange={(nodeId, column) => {
              if (nodeId === activeNodeId) {
                setSelectedColumn(column);
              }
            }}
            nodeColors={nodeColors}
            onColorChange={() => {}}
            defaultPalette={defaultPalette}
            maxCompare={1}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showColumnPicker
            showHeaderLabel
            showShape
            disabled={controlsDisabled}
            originalCount={selectedNodes.length}
            allowedDataTypes={['string']}
            fallbackToAllColumns={false}
            statusMessage={
              hasSelection && stringColumns.length === 0
                ? 'The selected data block has no string columns available for regex operations.'
                : undefined
            }
            headerAddon={
              <HelpIcon
                targetKey="preprocessing.common.node-selection"
                label="Selected data blocks"
                className="h-4 w-4 text-muted-foreground"
              />
            }
          />

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32 space-y-2">
              <Label htmlFor="find-mode">Mode</Label>
              <Select value={mode} onValueChange={(value: 'replace' | 'extract') => setMode(value)} disabled={controlsDisabled || !selectedColumn}>
                <SelectTrigger id="find-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace">Replace</SelectItem>
                  <SelectItem value="extract">Extract</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-44 space-y-2">
              <Label htmlFor="find-n">Match count</Label>
              <Input
                id="find-n"
                type="number"
                min={1}
                value={n ?? ''}
                onChange={(event) => setN(event.target.value ? Number(event.target.value) : null)}
                placeholder="All if left blank"
                disabled={controlsDisabled || !selectedColumn}
              />
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="find-pattern">Regex pattern</Label>
              <Input
                id="find-pattern"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                placeholder="\\d+"
                disabled={controlsDisabled || !selectedColumn}
              />
            </div>

            {mode === 'replace' ? (
              <>
                <span className="mb-2 text-sm text-muted-foreground">with</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="find-replacement">Replacement</Label>
                  <Input
                    id="find-replacement"
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                    placeholder="#"
                    disabled={controlsDisabled || !selectedColumn}
                  />
                </div>
              </>
            ) : (
              <>
                <span className="mb-2 text-sm text-muted-foreground">join with</span>
                <div className="w-56 max-w-full space-y-2">
                  <Label htmlFor="find-connector">Connector</Label>
                  <Input
                    id="find-connector"
                    value={connector}
                    onChange={(event) => setConnector(event.target.value)}
                    placeholder={'" " will be used by default'}
                    disabled={controlsDisabled || !selectedColumn}
                  />
                </div>
              </>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex items-center gap-3 border-t border-border bg-muted/20 py-4">
          <div className="flex flex-1 items-center gap-2">
            <Label htmlFor="replace-output-column" className="shrink-0">Output column name</Label>
            <Input
              id="replace-output-column"
              value={outputColumnName}
              onChange={(event) => setOutputColumnName(event.target.value)}
              onKeyDown={(event) => acceptPlaceholderOnTab({ event, value: outputColumnName, setValue: setOutputColumnName })}
              placeholder={selectedColumn || 'Leave blank to overwrite the selected column'}
              disabled={controlsDisabled || !selectedColumn}
              className="min-w-0 flex-1"
            />
          </div>
          <DisabledReasonTooltip reason={applyDisabledReason}>
            <Button type="button" size="sm" onClick={() => void handleApply()} disabled={!canApply} className="shrink-0">
              {applyLoading ? 'Applying…' : 'Add to Data Block'}
            </Button>
          </DisabledReasonTooltip>
          <HelpIcon targetKey="preprocessing.common.apply-button" label="Apply action" />
        </CardFooter>
      </Card>

      <PreviewTable
        title={
          <span className="flex items-center gap-2">
            Preview results
            <HelpIcon targetKey="preprocessing.common.preview" label="Preview table" />
          </span>
        }
        description="Review the updated rows before applying to the selected data block."
        columns={preview.columns}
        data={preview.data}
        pagination={preview.pagination}
        loading={preview.loading}
        error={preview.error}
        ready={preview.ready}
        readyMessage={preview.readyMessage}
        page={preview.page}
        pageSize={preview.pageSize}
        documentColumn={getNodeDocumentColumn(effectiveNodes[0])}
        onPageSizeChange={preview.setPageSize}
        onPageChange={preview.onPageChange}
      />
    </div>
  );
};

export default ReplaceSubTab;