import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Label } from '../../../../../components/ui/label';
import { Input } from '../../../../../components/ui/input';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import { Loader2, Play, Trash2 } from 'lucide-react';
import HelpIcon from '../../../../../components/help/HelpIcon';
import NodeSelectionPanel from '../../../../../components/NodeSelectionPanel';
import type { NodeColumnSelection } from '../../../../../hooks/useAutoNodeColumns';

type Props = {
  selectedNodes: Array<{ id?: string; name?: string }>;
  nodeColumnSelections: NodeColumnSelection[];
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string, string>;
  onNodeColorChange: (nodeId: string, color: string) => void;
  defaultPalette: string[];
  isLocked: boolean;
  getNodeColumns: (node: any, idx?: number) => any[];
  actionState: { runDisabled: boolean; clearDisabled: boolean };
  minTopicSize: number;
  onMinTopicSizeChange: (value: number) => void;
  useCtTfidf: boolean;
  onUseCtTfidfChange: (value: boolean) => void;
  isRunning: boolean;
  isClearing: boolean;
  onRun: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
  hasMissingColumns: boolean;
  error: string | null;
  resultState?: string;
  resultMessage?: string;
};

export function TopicModelingParameterPanel({
  selectedNodes,
  nodeColumnSelections,
  onColumnChange,
  nodeColors,
  onNodeColorChange,
  defaultPalette,
  isLocked,
  getNodeColumns,
  actionState,
  minTopicSize,
  onMinTopicSizeChange,
  useCtTfidf,
  onUseCtTfidfChange,
  isRunning,
  isClearing,
  onRun,
  onClear,
  hasMissingColumns,
  error,
  resultState,
  resultMessage,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Topic Modeling Parameters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <NodeSelectionPanel
          selectedNodes={selectedNodes}
          nodeColumnSelections={nodeColumnSelections}
          onColumnChange={onColumnChange}
          nodeColors={nodeColors}
          onColorChange={onNodeColorChange}
          defaultPalette={defaultPalette}
          getNodeColumns={getNodeColumns}
          maxCompare={2}
          disabled={isLocked}
          locked={isLocked}
        />

        {selectedNodes.length === 1 && hasMissingColumns ? (
          <p className="text-xs text-destructive">Please select a text column for the selected node.</p>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="min-topic-size">Min Topic Size</Label>
              <HelpIcon targetKey="analysis.topic-modeling.min-topic-size" />
            </div>
            <Input
              id="min-topic-size"
              type="number"
              min={2}
              max={100}
              step={1}
              value={minTopicSize}
              onChange={(event) => onMinTopicSizeChange(Math.max(2, Number(event.target.value) || 0))}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded border px-3 py-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="use-ctfidf" className="text-sm">Use c-TF-IDF</Label>
                <HelpIcon targetKey="analysis.topic-modeling.use-ct-tfidf" />
              </div>
              <Checkbox id="use-ctfidf" checked={useCtTfidf} onCheckedChange={(checked) => onUseCtTfidfChange(Boolean(checked))} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={onRun} disabled={actionState.runDisabled || isRunning || hasMissingColumns}>
            {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {isRunning ? 'Running…' : 'Run Topic Modeling'}
          </Button>

          <Button variant="outline" onClick={onClear} disabled={actionState.clearDisabled || isClearing}>
            {isClearing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
            {isClearing ? 'Clearing…' : 'Clear Results'}
          </Button>
        </div>

        {error && resultState !== 'failed' && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}
        {resultState === 'failed' && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p>{resultMessage || 'Topic modeling failed'}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
