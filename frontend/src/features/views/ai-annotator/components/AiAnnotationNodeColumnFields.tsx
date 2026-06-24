import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { UseTabNodeInputsResult } from '../../common/nodeInputs';

interface AnnotationEmptyOption {
  value: string;
  label: string;
}

interface AiAnnotationNodeColumnFieldsProps {
  nodeInputs: UseTabNodeInputsResult;
  textColumn: string;
  textColumns: ColumnInfo[];
  annotationColumn: string;
  annotationColumns: ColumnInfo[];
  textSelectId: string;
  annotationSelectId: string;
  annotationEmptyOption?: AnnotationEmptyOption;
  onNodeColumnChange: (nodeId: string, column: string) => void;
  onTextColumnChange: (column: string) => void;
  onAnnotationColumnChange: (column: string) => void;
}

/**
 * Renders the shared node/text/annotation column picker used by both AI
 * annotation and review tabs.
 * Rendered by: AiAnnotatorFeature because both tab parameter forms need the
 * same node-selection layout while keeping different annotation-column empty
 * behavior.
 * Flow: show the standard one-node selector, render the tab-specific text and
 * annotation selects, and optionally expose a sentinel option that maps to an
 * empty annotation target.
 */
export function AiAnnotationNodeColumnFields({
  nodeInputs,
  textColumn,
  textColumns,
  annotationColumn,
  annotationColumns,
  textSelectId,
  annotationSelectId,
  annotationEmptyOption,
  onNodeColumnChange,
  onTextColumnChange,
  onAnnotationColumnChange,
}: AiAnnotationNodeColumnFieldsProps) {
  const annotationValue =
    annotationColumn || (annotationEmptyOption ? annotationEmptyOption.value : '');

  return (
    <>
      <NodeInputsPanel
        resolvedNodes={nodeInputs.resolvedNodes}
        availableNodes={nodeInputs.availableNodes}
        graphSelectedIds={nodeInputs.graphSelectedIds}
        recentPresets={nodeInputs.recentPresets}
        canAddMore={nodeInputs.canAddMore}
        maxNodes={1}
        onAddNodes={nodeInputs.addNodes}
        getAddRejection={nodeInputs.getAddRejection}
        onRemoveNode={nodeInputs.removeNode}
        onClear={nodeInputs.clear}
        onColumnChange={onNodeColumnChange}
        showColumnPicker={false}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground" htmlFor={textSelectId}>
            Text Column
          </Label>
          <Select
            value={textColumn}
            onValueChange={(value) => {
              onTextColumnChange(value);
            }}
          >
            <SelectTrigger id={textSelectId} className="w-full text-sm">
              <SelectValue placeholder="Select text column" />
            </SelectTrigger>
            <SelectContent>
              {textColumns.map((column) => (
                <SelectItem key={column.name} value={column.name}>
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground" htmlFor={annotationSelectId}>
            Annotation Column
          </Label>
          <Select
            value={annotationValue}
            onValueChange={(value) => {
              onAnnotationColumnChange(value === annotationEmptyOption?.value ? '' : value);
            }}
          >
            <SelectTrigger id={annotationSelectId} className="w-full text-sm">
              <SelectValue placeholder="Select annotation column" />
            </SelectTrigger>
            <SelectContent>
              {annotationEmptyOption ? (
                <SelectItem value={annotationEmptyOption.value}>
                  {annotationEmptyOption.label}
                </SelectItem>
              ) : null}
              {annotationColumns.map((column) => (
                <SelectItem key={column.name} value={column.name}>
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}
