import React from 'react';
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

import type {
  SequentialCustomIntervalUnit,
  SequentialFrequency,
} from '@/api/text';
import { UniqueValueCount } from '../UniqueValueCount';

interface ColumnLike {
  name: string;
  dataType: string;
}

interface NodeColumnSelectionLike {
  nodeId: string;
  column: string;
}

const FREQUENCY_OPTIONS: Array<{ value: SequentialFrequency; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Customised' },
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

  // Configuration shared
  derivedColumnType: 'datetime' | 'numeric';
  inputsDisabled: boolean;
  activeNodeId: string | null | undefined;
  selectedNodeId: string | null | undefined;
  currentWorkspaceId: string | null | undefined;

  // Datetime branch
  frequency: SequentialFrequency;
  onFrequencyChange: (value: SequentialFrequency) => void;
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
}

/**
 * Sequential Analysis parameter panel: NodeSelectionPanel + the
 * frequency/numeric-interval/group-by configuration block. Extracted
 * from SequentialAnalysisFeature.tsx; the surrounding AnalysisCardLayout
 * frame stays in the parent because run/clear actions belong to
 * orchestration state.
 */
export const SequentialAnalysisParameterPanel: React.FC<SequentialAnalysisParameterPanelProps> = ({
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
}) => (
  <>
    <NodeSelectionPanel
      selectedNodes={selectedNodes}
      nodeColumnSelections={nodeColumnSelections}
      onColumnChange={onColumnChange}
      nodeColors={{}}
      onColorChange={() => {}}
      getNodeColumns={() => timeCompatibleColumns}
      defaultPalette={[]}
      maxCompare={1}
      className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
      showShape
      showColorPicker={false}
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
      lockedMessage={ANALYSIS_LOCKED_MESSAGE}
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
                  {FREQUENCY_OPTIONS.map((option) => (
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
            disabled={groupByColumns.length >= 3}
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
              value={column || undefined}
              onValueChange={(value) => onGroupByColumnChange(index, value)}
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
