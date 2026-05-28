import { Plus, Trash2 } from 'lucide-react';

import HelpIcon from '@/components/help/HelpIcon';
import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/analysis/common/components/AnalysisLockedNotice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';
import { UniqueValueCount } from '../UniqueValueCount';

type SequentialFrequency = NonNullable<SequentialAnalysisRequestInput['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<
  SequentialAnalysisRequestInput['custom_interval_unit']
>;

interface ColumnLike {
  name: string;
  dataType: string;
}

interface NodeColumnSelectionLike {
  nodeId: string;
  column: string;
}

const FREQUENCY_LABELS: Record<SequentialFrequency, string> = {
  second: 'Per second',
  minute: 'Per minute',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  custom: 'Customised',
};

/** Default live-mode dropdown — hourly..yearly + custom. Snapshot
 * mode passes a filtered list via the ``frequencyOptions`` prop. */
const DEFAULT_FREQUENCY_OPTIONS: Array<{ value: SequentialFrequency; label: string }> = [
  { value: 'hourly', label: FREQUENCY_LABELS.hourly },
  { value: 'daily', label: FREQUENCY_LABELS.daily },
  { value: 'weekly', label: FREQUENCY_LABELS.weekly },
  { value: 'monthly', label: FREQUENCY_LABELS.monthly },
  { value: 'quarterly', label: FREQUENCY_LABELS.quarterly },
  { value: 'yearly', label: FREQUENCY_LABELS.yearly },
  { value: 'custom', label: FREQUENCY_LABELS.custom },
];

const CUSTOM_INTERVAL_UNIT_OPTIONS: Array<{
  value: SequentialCustomIntervalUnit;
  label: string;
}> = [
  { value: 'seconds', label: 'seconds' },
  { value: 'minutes', label: 'minutes' },
  { value: 'hours', label: 'hours' },
  { value: 'days', label: 'days' },
  { value: 'weeks', label: 'weeks' },
];

export interface SequentialAnalysisParameterPanelProps {
  // Node selection
  selectedNodes: Array<Record<string, unknown>>;
  nodeColumnSelections: NodeColumnSelectionLike[];
  timeCompatibleColumns: ColumnLike[];
  timeCompatibleTypes: string[];
  isLocked: boolean;
  displayNodeCount: number;
  onColumnChange: (nodeId: string, column: string) => void;
  /** Displayed when the panel is locked. Defaults to the standard
   * "locked while results loaded" message; snapshot mode passes a
   * tailored "viewing saved snapshot" string. */
  lockedMessage?: string;

  // Configuration shared
  derivedColumnType: 'datetime' | 'numeric';
  inputsDisabled: boolean;
  activeNodeId: string | null | undefined;
  selectedNodeId: string | null | undefined;
  currentWorkspaceId: string | null | undefined;

  // Datetime branch
  frequency: SequentialFrequency;
  onFrequencyChange: (value: SequentialFrequency) => void;
  /** Optional override for the frequency dropdown options. Snapshot
   * mode passes a filtered list (coarser-or-equal to the captured
   * finest frequency) so the viewer can't ask for a refinement
   * the captured data can't support. Defaults to the live preset
   * list (hourly..yearly + custom). */
  frequencyOptions?: Array<{ value: SequentialFrequency; label: string }>;
  customIntervalValueInput: string;
  onCustomIntervalValueChange: (value: string) => void;
  customIntervalUnit: SequentialCustomIntervalUnit;
  onCustomIntervalUnitChange: (value: SequentialCustomIntervalUnit) => void;

  // Numeric branch
  numericOriginInput: string;
  onNumericOriginChange: (value: string) => void;
  numericIntervalInput: string;
  onNumericIntervalChange: (value: string) => void;

  // Group by
  availableColumns: ColumnLike[];
  groupByColumns: string[];
  onAddGroupByColumn: () => void;
  onRemoveGroupByColumn: (index: number) => void;
  onGroupByColumnChange: (index: number, value: string) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (value: boolean) => void;

  // Node-colour management (lifted from the panel to the feature
  // parent so the same hook instance can expose ``promoteTempColors``
  // to the Run handler). See node-colour strategy doc.
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  onColorChange: (nodeId: string, color: string) => void;
}

/**
 * Rendered by: SequentialAnalysisFeature. Sequential Analysis parameter panel: NodeSelectionPanel + the because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * frequency/numeric-interval/group-by configuration block. Extracted
 * from SequentialAnalysisFeature.tsx; the surrounding AnalysisCardLayout
 * frame stays in the parent because run/clear actions belong to
 * orchestration state.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function SequentialAnalysisParameterPanel({
  selectedNodes,
  nodeColumnSelections,
  timeCompatibleColumns,
  timeCompatibleTypes,
  isLocked,
  displayNodeCount,
  onColumnChange,
  derivedColumnType,
  inputsDisabled,
  activeNodeId,
  selectedNodeId,
  currentWorkspaceId,
  frequency,
  onFrequencyChange,
  customIntervalValueInput,
  onCustomIntervalValueChange,
  customIntervalUnit,
  onCustomIntervalUnitChange,
  frequencyOptions = DEFAULT_FREQUENCY_OPTIONS,
  numericOriginInput,
  onNumericOriginChange,
  numericIntervalInput,
  onNumericIntervalChange,
  availableColumns,
  groupByColumns,
  onAddGroupByColumn,
  onRemoveGroupByColumn,
  onGroupByColumnChange,
  caseSensitive,
  onCaseSensitiveChange,
  nodeColors,
  defaultPalette,
  onColorChange,
  lockedMessage = ANALYSIS_LOCKED_MESSAGE,
}: SequentialAnalysisParameterPanelProps) {
  return (
    <>
      <NodeSelectionPanel
        selectedNodes={selectedNodes}
        nodeColumnSelections={nodeColumnSelections}
        onColumnChange={onColumnChange}
        nodeColors={nodeColors}
        onColorChange={onColorChange}
        getNodeColumns={() => timeCompatibleColumns}
        defaultPalette={defaultPalette}
        maxCompare={1}
        className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
        showShape
        showColorPicker
        disabled={!!isLocked}
        locked={!!isLocked}
        originalCount={displayNodeCount}
        columnLabelFn={() => (
          <span className="inline-flex items-center gap-1">
            Time/Numeric Column *
            <HelpIcon
              targetKey="analysis.sequential-analysis.time-column"
              label="Time column selector"
            />
          </span>
        )}
        allowedDataTypes={timeCompatibleTypes}
        lockedMessage={lockedMessage}
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {derivedColumnType === 'datetime' ? (
            <div className={frequency === 'custom' ? 'md:col-span-2' : 'md:col-span-1'}>
              <div className="mb-1 flex items-center gap-2">
                <label className="block text-sm font-medium text-gray-700">Frequency</label>
                <HelpIcon
                  targetKey="analysis.sequential-analysis.frequency"
                  label="Frequency selector"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={frequency}
                  onValueChange={(value) => onFrequencyChange(value as SequentialFrequency)}
                  disabled={inputsDisabled}
                >
                  <SelectTrigger className={frequency === 'custom' ? 'w-full sm:w-44' : 'w-full'}>
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    {frequencyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {frequency === 'custom' && (
                  <div className="flex flex-1 items-center gap-2">
                    <span className="text-sm text-muted-foreground">Every</span>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={customIntervalValueInput}
                      onChange={(event) => onCustomIntervalValueChange(event.target.value)}
                      placeholder="e.g. 30"
                      className="w-24"
                      disabled={inputsDisabled}
                    />
                    <Select
                      value={customIntervalUnit}
                      onValueChange={(value) =>
                        onCustomIntervalUnitChange(value as SequentialCustomIntervalUnit)
                      }
                      disabled={inputsDisabled}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue placeholder="Unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {CUSTOM_INTERVAL_UNIT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {frequency === 'custom' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Bucket records by a fixed interval. Enter a positive whole number.
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Numeric Origin
                </label>
                <Input
                  type="number"
                  value={numericOriginInput}
                  onChange={(event) => onNumericOriginChange(event.target.value)}
                  placeholder="Auto-detect"
                  disabled={inputsDisabled}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional. Leave blank to auto-detect from the minimum value.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Numeric Interval *
                </label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={numericIntervalInput}
                  onChange={(event) => onNumericIntervalChange(event.target.value)}
                  placeholder="e.g. 10"
                  disabled={inputsDisabled}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Required. Values are bucketed using this interval width.
                </p>
              </div>
            </>
          )}
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Group By Columns (Optional, max 3)
            </label>
            <Button
              onClick={onAddGroupByColumn}
              disabled={inputsDisabled || groupByColumns.length >= 3}
              size="sm"
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Group
            </Button>
          </div>

          {groupByColumns.map((column, index) => (
            <div key={index} className="flex items-center space-x-2 mb-2">
              <Select
                value={column}
                onValueChange={(value) => onGroupByColumnChange(index, value)}
                disabled={inputsDisabled}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {availableColumns.map((col) => (
                    <SelectItem key={col.name} value={col.name}>
                      {col.name} ({col.dataType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {column && (
                <UniqueValueCount
                  workspaceId={currentWorkspaceId || ''}
                  nodeId={activeNodeId || selectedNodeId || ''}
                  columnName={column}
                />
              )}
              <Button
                onClick={() => onRemoveGroupByColumn(index)}
                variant="destructive"
                size="sm"
                disabled={inputsDisabled}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            </div>
          ))}

          {groupByColumns.length > 0 && (
            <div className="flex items-center space-x-2 mt-2">
              <Checkbox
                id="case-sensitive"
                checked={caseSensitive}
                onCheckedChange={(checked) => onCaseSensitiveChange(checked === true)}
                disabled={inputsDisabled}
              />
              <label
                htmlFor="case-sensitive"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Case sensitive
              </label>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
