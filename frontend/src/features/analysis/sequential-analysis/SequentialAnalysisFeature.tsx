import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { useAuth } from '../../../hooks/useAuth';
import { useUIStore } from '../../../stores/uiStore';
import { useSchemaManagement } from '../../../hooks/useSchemaManagement';
import {
  type SequentialCustomIntervalUnit,
  type SequentialFrequency,
  textApi,
} from '../../../api/text';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';

import { ANALYSIS_LOCKED_MESSAGE } from '../../../components/tabs/AnalysisLockedNotice';
import { normalizeSchemaFromInfo } from '../../../hooks/useSchemaManagement';
import { getNodeInfo } from '../../../lib/nodeInfoCache';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import HelpIcon from '../../../components/help/HelpIcon';
import InfoIcon from '../../../components/help/InfoIcon';
import AnalysisTaskBanner from '../../../components/tabs/AnalysisTaskBanner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Checkbox } from '../../../components/ui/checkbox';
import { Download, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { normalizeTypeName } from '../../../utils/columnTypes';
import {
  hasLockedParameterDiff,
  normalizeStringArray,
  normalizeUnknownStringArray,
  useAnalysisLock,
  useAnalysisFeature,
  getAnalysisActionState,
  useSafeResult,
  restoreAnalysisLockFromRequest,
  resetAnalysisSelectionAfterClear,
  executeAnalysisRunOrUpdate,
} from '../common';
import {
  useSequentialAnalysisTaskFlow,
  isChartTypeOption,
  getPaletteColor,
  type ChartTypeOption,
} from './hooks/useSequentialAnalysisTaskFlow';
import { useSequentialAnalysisDetach } from './hooks/useSequentialAnalysisDetach';
import { UniqueValueCount } from './components/UniqueValueCount';
import { SequentialChart } from './components/SequentialChart';
import { ChartImageDownloadDialog } from '../../../components/ui/ChartImageDownloadDialog';
import {
  downloadChartAs,
  findSvgInContainer,
  type ChartImageFormat,
  type ChartExportHeaderItem,
  type ChartExportLegendItem,
} from '../../../lib/chartExport';

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

const VALID_CUSTOM_INTERVAL_UNITS: SequentialCustomIntervalUnit[] =
  CUSTOM_INTERVAL_UNIT_OPTIONS.map((opt) => opt.value);

const isCustomIntervalUnit = (value: unknown): value is SequentialCustomIntervalUnit =>
  typeof value === 'string' &&
  VALID_CUSTOM_INTERVAL_UNITS.includes(value as SequentialCustomIntervalUnit);

const TIME_COMPATIBLE_TYPES = ['datetime', 'integer', 'float'] as const;
const NUMERIC_TYPE_SET = new Set(['integer', 'float']);

const parseNumericInput = (value: string): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveIntegerInput = (value: string): number | null => {
  const parsed = parseNumericInput(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseNonNegativeIntegerInput = (value: string): number | null => {
  const parsed = parseNumericInput(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

const SequentialAnalysisFeature = () => {
  const queryClient = useQueryClient();
  const { selectedNodeId, selectedNode } = useWorkspaceSelection();
  const { nodeData, currentWorkspaceId } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'analysis';

  const { getAuthHeaders } = useAuth();
  const {
    isLocked,
    lockWithSnapshots,
    unlockSelection,
    activeNodeId,
    nodeColumnSelections,
    setNodeColumnSelections,
    displayNodeCount,
    serverRequest,
    panelSelectedNodes,
  } = useAnalysisLock({
    analysisType: 'sequential_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['datetime'],
    maxNodes: 1,
    docTypeOnly: false,
    storageScope: 'sequential-analysis',
  });

  const [timeColumn, setTimeColumn] = useState('');
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<SequentialFrequency>('daily');
  const [chartType, setChartType] = useState<ChartTypeOption>('line');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [numericOriginInput, setNumericOriginInput] = useState<string>('');
  const [numericIntervalInput, setNumericIntervalInput] = useState<string>('1');
  const [customIntervalValueInput, setCustomIntervalValueInput] = useState<string>('1');
  const [customIntervalUnit, setCustomIntervalUnit] =
    useState<SequentialCustomIntervalUnit>('minutes');
  const [minGroupSizeInput, setMinGroupSizeInput] = useState('10');
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [selectedPeriodIndices, setSelectedPeriodIndices] = useState<Set<number>>(new Set());
  const [detachNodeName, setDetachNodeName] = useState('');
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  // Use schema management hook
  const {
    setLockedSchema,
    availableColumns,
    lockCurrentSchema,
    currentSchemaRef,
  } = useSchemaManagement({
    nodeId: activeNodeId,
    isLocked,
    workspaceId: currentWorkspaceId || undefined,
    getAuthHeaders,
    nodeData: nodeData ?? undefined,
    selectedNode: selectedNode ?? undefined,
  });

  const [results, resultRef, setResultSafely, setResults] = useSafeResult<Record<string, unknown>>();
  const [hydratingSelection, setHydratingSelection] = useState(false);
  const hydratedParamsRef = useRef<{
    timeColumn: string;
    groupByColumns: string[];
    frequency: SequentialFrequency;
    columnType: 'datetime' | 'numeric';
    numericOrigin: number | null;
    numericInterval: number | null;
    customIntervalValue: number | null;
    customIntervalUnit: SequentialCustomIntervalUnit | null;
    caseSensitive: boolean;
  } | null>(null);

  const {
    resolveTaskId,
    setLocalTaskId,
    isRunning: isAnalyzing,
    setIsRunning: setIsAnalyzing,
    banner: sequentialWaitingBanner,
    hasActiveTask,
    clearResults,
  } = useAnalysisFeature<Record<string, unknown>>({
    analysisType: 'sequential_analysis',
    taskType: 'sequential_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef,
    fetchResult: async (taskId, headers) =>
      textApi.getSequentialAnalysisTaskResult(taskId, headers),
    fetchRequest: async (taskId, headers) =>
      textApi.getSequentialAnalysisTaskRequest(taskId, headers),
    onResultFetched: (resultData) => {
      if (!resultData) return;
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      const resolvedChartType = isChartTypeOption((resultData as Record<string, unknown>)?.chart_type)
        ? (resultData as Record<string, unknown>).chart_type as ChartTypeOption
        : chartType;
      setResultSafely({
        ...(resultData as Record<string, unknown>),
        analysis_params: {
          ...((results as Record<string, unknown> | null)?.analysis_params as Record<string, unknown> ?? {}),
          ...((resultData as Record<string, unknown>)?.analysis_params as Record<string, unknown> ?? {}),
        },
        chart_type: resolvedChartType,
      });
      setChartType(resolvedChartType);
    },
    onHydratedResult: (resultPayload) => {
      if (!resultPayload) return;
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      const hydratedParams = hydratedParamsRef.current;
      const enriched = {
        ...(resultPayload as Record<string, unknown>),
        analysis_params: {
          ...((resultPayload as Record<string, unknown>)?.analysis_params as Record<string, unknown> ?? {}),
          ...(hydratedParams
            ? {
                group_by_columns: hydratedParams.groupByColumns,
                time_column: hydratedParams.timeColumn,
                frequency: hydratedParams.frequency,
                column_type: hydratedParams.columnType,
                numeric_origin: hydratedParams.numericOrigin,
                numeric_interval: hydratedParams.numericInterval,
                custom_interval_value: hydratedParams.customIntervalValue,
                custom_interval_unit: hydratedParams.customIntervalUnit,
                case_sensitive: hydratedParams.caseSensitive,
              }
            : {}),
        },
      };
      const resolvedChartType = isChartTypeOption((resultPayload as Record<string, unknown>)?.chart_type)
        ? (resultPayload as Record<string, unknown>).chart_type as ChartTypeOption
        : chartType;
      setResults({ ...enriched, chart_type: resolvedChartType });
      setChartType(resolvedChartType);
    },
    onHydratedRequest: async (requestPayload) => {
      const req = ((requestPayload as Record<string, unknown>)?.data ?? requestPayload) as Record<string, unknown> | null;
      if (!req) return;
      setHydratingSelection(true);
      const nodeIdStr = String(req.node_id || req.nodeId || '');
      const reqTimeColumn = typeof req.time_column === 'string' ? req.time_column : '';
      const reqColumnType = req.column_type === 'numeric' ? 'numeric' : 'datetime';
      const lockedNumericOrigin = reqColumnType === 'numeric' && typeof req.numeric_origin === 'number'
        ? req.numeric_origin : null;
      const lockedNumericInterval = reqColumnType === 'numeric' && typeof req.numeric_interval === 'number'
        ? req.numeric_interval : null;
      if (reqColumnType === 'numeric') {
        setNumericOriginInput(lockedNumericOrigin != null ? String(lockedNumericOrigin) : '');
        setNumericIntervalInput(lockedNumericInterval != null ? String(lockedNumericInterval) : '1');
      } else {
        setNumericOriginInput('');
        setNumericIntervalInput('1');
      }
      if (nodeIdStr && reqTimeColumn) {
        setNodeColumnSelections([{ nodeId: nodeIdStr, column: reqTimeColumn }]);
        setTimeColumn(reqTimeColumn);
      }
      const normalizedGroups = Array.isArray(req.group_by_columns)
        ? req.group_by_columns.filter((col: unknown): col is string => typeof col === 'string' && col.trim() !== '')
        : [];
      setGroupByColumns(normalizedGroups.length ? [...normalizedGroups] : []);
      const validFrequencies: SequentialFrequency[] = ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];
      const reqFrequency = typeof req.frequency === 'string' ? (req.frequency as SequentialFrequency) : undefined;
      const lockedFrequency = reqFrequency && validFrequencies.includes(reqFrequency) ? reqFrequency : frequency;
      setFrequency(lockedFrequency);
      const lockedCustomIntervalValue =
        reqColumnType === 'datetime' &&
        lockedFrequency === 'custom' &&
        typeof req.custom_interval_value === 'number' &&
        Number.isInteger(req.custom_interval_value) &&
        req.custom_interval_value > 0
          ? (req.custom_interval_value as number)
          : null;
      const lockedCustomIntervalUnit =
        reqColumnType === 'datetime' &&
        lockedFrequency === 'custom' &&
        isCustomIntervalUnit(req.custom_interval_unit)
          ? (req.custom_interval_unit as SequentialCustomIntervalUnit)
          : null;
      if (lockedFrequency === 'custom' && reqColumnType === 'datetime') {
        setCustomIntervalValueInput(
          lockedCustomIntervalValue != null ? String(lockedCustomIntervalValue) : '1',
        );
        setCustomIntervalUnit(lockedCustomIntervalUnit ?? 'minutes');
      } else {
        setCustomIntervalValueInput('1');
        setCustomIntervalUnit('minutes');
      }
      const reqCaseSensitive = typeof req.case_sensitive === 'boolean' ? req.case_sensitive : true;
      setCaseSensitive(reqCaseSensitive);
      hydratedParamsRef.current = {
        timeColumn: reqTimeColumn,
        groupByColumns: normalizedGroups.length ? [...normalizedGroups] : [],
        frequency: lockedFrequency,
        columnType: reqColumnType,
        numericOrigin: lockedNumericOrigin,
        numericInterval: lockedNumericInterval,
        customIntervalValue: lockedCustomIntervalValue,
        customIntervalUnit: lockedCustomIntervalUnit,
        caseSensitive: reqCaseSensitive,
      };
      if (nodeIdStr && currentWorkspaceId) {
        try {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: { node_ids: [nodeIdStr], node_columns: { [nodeIdStr]: reqTimeColumn } },
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 1,
          });
          const info = await getNodeInfo({ workspaceId: currentWorkspaceId, nodeId: nodeIdStr, getAuthHeaders });
          const normalizedSchema = normalizeSchemaFromInfo(info);
          if (Object.keys(normalizedSchema).length > 0) {
            setLockedSchema(normalizedSchema);
          } else {
            setLockedSchema((prev) => prev ?? currentSchemaRef.current);
          }
        } catch {
          setLockedSchema((prev) => prev ?? currentSchemaRef.current);
        }
      }
      setHydratingSelection(false);
    },
    onCleared: (_, options) => {
      setResultSafely(null);
      setHiddenKeys(new Set());
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      if (options?.preserveLocalState) {
        return;
      }
      resetAnalysisSelectionAfterClear({ unlockSelection });
      setLockedSchema(null);
      setChartType('line');
      setCaseSensitive(true);
      setNumericOriginInput('');
      setNumericIntervalInput('1');
      setCustomIntervalValueInput('1');
      setCustomIntervalUnit('minutes');
    },
    getExtraTaskIdCandidates: () => [(resultRef.current as Record<string, unknown> | null)?.metadata as Record<string, unknown> | undefined].map(m => m?.task_id as string | undefined),
    getClearTaskIdSources: () => [(resultRef.current as Record<string, unknown> | null)?.metadata as Record<string, unknown> | undefined].map(m => m?.task_id as string | undefined),
    isResultRunning: (r: Record<string, unknown> | null) => Boolean(r) && r?.state === 'running',
  });

  const timeCompatibleColumns = availableColumns
        .map((column) => ({
          ...column,
          dataType: normalizeTypeName(column.dataType),
        }))
        .filter((column) => TIME_COMPATIBLE_TYPES.includes(column.dataType as (typeof TIME_COMPATIBLE_TYPES)[number]))
        .sort((a, b) => {
          const priority = (type: string) => (type === 'datetime' ? 0 : 1);
          return priority(a.dataType) - priority(b.dataType);
        });

  const timeColumnOptions = timeCompatibleColumns.map((column) => column.name);

  const activeTimeColumn = (() => {
    if (!activeNodeId) return '';
    const selection = nodeColumnSelections.find((s) => s.nodeId === activeNodeId);
    if (selection?.column) return selection.column;
    if (timeColumn) return timeColumn;
    const hydratedTime = ((results?.analysis_params as Record<string, unknown> | undefined)?.time_column as string | undefined) ?? '';
    return hydratedTime;
  })();

  const activeColumnInfo = timeCompatibleColumns.find((column) => column.name === activeTimeColumn);
  const activeColumnType = normalizeTypeName(activeColumnInfo?.dataType || (timeCompatibleColumns[0]?.dataType ?? 'datetime'));
  const derivedColumnType: 'datetime' | 'numeric' = NUMERIC_TYPE_SET.has(activeColumnType) ? 'numeric' : 'datetime';
  const numericOriginValue = derivedColumnType === 'numeric' ? parseNumericInput(numericOriginInput) : null;
  const numericIntervalValue = derivedColumnType === 'numeric' ? parseNumericInput(numericIntervalInput) : null;
  const isCustomDatetime = derivedColumnType === 'datetime' && frequency === 'custom';
  const customIntervalValue = isCustomDatetime
    ? parsePositiveIntegerInput(customIntervalValueInput)
    : null;
  const customIntervalUnitValue: SequentialCustomIntervalUnit | null = isCustomDatetime
    ? customIntervalUnit
    : null;

  const hasParamsChanged = hasLockedParameterDiff({
    isLocked,
    serverRequest: serverRequest as Record<string, unknown> | null,
    currentParams: {
      frequency,
      group_by_columns: normalizeStringArray(groupByColumns),
      column_type: derivedColumnType,
      numeric_origin: derivedColumnType === 'numeric' ? numericOriginValue : null,
      numeric_interval: derivedColumnType === 'numeric' ? numericIntervalValue : null,
      custom_interval_value: isCustomDatetime ? customIntervalValue : null,
      custom_interval_unit: isCustomDatetime ? customIntervalUnitValue : null,
      case_sensitive: caseSensitive,
    },
    getServerParams: (request) => {
      const serverColumnType = typeof request.column_type === 'string' ? request.column_type : 'datetime';
      const serverFrequency = typeof request.frequency === 'string' ? request.frequency : 'year';
      const serverNumericOrigin = request.numeric_origin == null ? null : Number(request.numeric_origin);
      const serverNumericInterval = request.numeric_interval == null ? null : Number(request.numeric_interval);
      const serverIsCustomDatetime =
        serverColumnType === 'datetime' && serverFrequency === 'custom';
      const serverCustomIntervalValue =
        serverIsCustomDatetime && typeof request.custom_interval_value === 'number'
          ? Number(request.custom_interval_value)
          : null;
      const serverCustomIntervalUnit =
        serverIsCustomDatetime && isCustomIntervalUnit(request.custom_interval_unit)
          ? (request.custom_interval_unit as SequentialCustomIntervalUnit)
          : null;

      const serverCaseSensitive = typeof request.case_sensitive === 'boolean' ? request.case_sensitive : true;
      return {
        frequency: serverFrequency,
        group_by_columns: normalizeUnknownStringArray(request.group_by_columns),
        column_type: serverColumnType,
        numeric_origin: serverColumnType === 'numeric' ? serverNumericOrigin : null,
        numeric_interval: serverColumnType === 'numeric' ? serverNumericInterval : null,
        custom_interval_value: serverIsCustomDatetime ? serverCustomIntervalValue : null,
        custom_interval_unit: serverIsCustomDatetime ? serverCustomIntervalUnit : null,
        case_sensitive: serverCaseSensitive,
      };
    },
  });

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: Boolean(activeNodeId),
    isLocked,
    hasResults: Boolean(results),
    isBusy: isAnalyzing,
    hasActiveTask,
    allowRunWhenLocked: hasParamsChanged,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- Complex sync logic with guards to prevent infinite loops; refactoring to render-time would duplicate guard logic */
  useEffect(() => {
    if (isLocked || hydratingSelection) return;
    if (!selectedNodeId) {
      if (nodeColumnSelections.length > 0) {
        setNodeColumnSelections([], { replace: true });
      }
      if (timeColumn !== '') {
        setTimeColumn('');
      }
      return;
    }

    if (!timeColumnOptions.length) {
      // Check current state before updating to avoid infinite loop
      const currentSelection = nodeColumnSelections.find(s => s.nodeId === selectedNodeId);
      if (!currentSelection || currentSelection.column !== '') {
        setNodeColumnSelections([{ nodeId: selectedNodeId, column: '' }]);
      }
      if (timeColumn !== '') {
        setTimeColumn('');
      }
      return;
    }

    const desired = timeColumnOptions.includes(timeColumn) ? timeColumn : timeColumnOptions[0]!;
    if (desired !== timeColumn) {
      setTimeColumn(desired);
    }

    // Check current state before updating to avoid infinite loop
    const currentSelection = nodeColumnSelections.find(s => s.nodeId === selectedNodeId);
    if (!currentSelection || currentSelection.column !== desired) {
      setNodeColumnSelections([{ nodeId: selectedNodeId, column: desired }]);
    }
  }, [isLocked, hydratingSelection, selectedNodeId, timeColumnOptions, setNodeColumnSelections, nodeColumnSelections, timeColumn]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleAddGroupByColumn = () => {
    if (groupByColumns.length < 3) {
      setGroupByColumns([...groupByColumns, '']);
    }
  };

  const handleRemoveGroupByColumn = (index: number) => {
    setGroupByColumns(groupByColumns.filter((_, i) => i !== index));
  };

  const handleGroupByColumnChange = (index: number, value: string) => {
    const newColumns = [...groupByColumns];
    newColumns[index] = value;
    setGroupByColumns(newColumns);
  };

  const handleToggleKey = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const {
    handleAnalyze,
    handleClearResults,
    handleChartTypeChange,
    chartData,
    groupKeys,
    chartConfig,
    groupPointCounts,
  } = useSequentialAnalysisTaskFlow({
    state: {
      currentWorkspaceId,
      activeNodeId,
      nodeColumnSelections,
      timeColumn,
      groupByColumns,
      frequency,
      chartType,
      derivedColumnType,
      numericOriginValue,
      numericIntervalValue,
      numericOriginInput,
      customIntervalValue,
      customIntervalUnit: customIntervalUnitValue,
      caseSensitive,
      results,
    },
    actions: {
      setIsAnalyzing,
      setResults,
      setChartType,
      setLocalTaskId,
      setNodeColumnSelections,
      setTimeColumn,
      lockWithSnapshots,
      lockCurrentSchema,
      resolveTaskId,
      clearResults,
    },
    lock: { getAuthHeaders },
  });

  const handlePeriodClick = (index: number, shiftHeld: boolean) => {
    if (index < 0 || index >= chartData.length) return;

    setSelectedPeriodIndices((prev) => {
      const next = new Set(prev);

      if (shiftHeld && lastClickedIndexRef.current !== null) {
        const lower = Math.min(lastClickedIndexRef.current, index);
        const upper = Math.max(lastClickedIndexRef.current, index);
        for (let cursor = lower; cursor <= upper; cursor += 1) {
          next.add(cursor);
        }
      } else {
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        lastClickedIndexRef.current = index;
      }

      return next;
    });
  };

  const clearPeriodSelection = () => {
    setSelectedPeriodIndices(new Set());
    lastClickedIndexRef.current = null;
  };

  const handleRunOrUpdate = async () => {
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleAnalyze,
      clearOptionsOnUpdate: { preserveLocalState: true },
    });
  };

  const summaryTimeColumn = ((results?.analysis_params as Record<string, unknown> | undefined)?.time_column as string | undefined) ?? timeColumn;
  const summaryGroupBy = ((results?.analysis_params as Record<string, unknown> | undefined)?.group_by_columns as string[] | undefined) ?? groupByColumns;
  const summaryColumnType = ((results?.analysis_params as Record<string, unknown> | undefined)?.column_type as 'datetime' | 'numeric' | undefined) ?? derivedColumnType;
  const summaryNumericOrigin = summaryColumnType === 'numeric'
    ? ((results?.analysis_params as Record<string, unknown> | undefined)?.numeric_origin as number | null | undefined) ?? numericOriginValue ?? null
    : null;
  const summaryNumericInterval = summaryColumnType === 'numeric'
    ? ((results?.analysis_params as Record<string, unknown> | undefined)?.numeric_interval as number | null | undefined) ?? numericIntervalValue ?? null
    : null;
  const rawSummaryFrequency =
    ((results?.analysis_params as Record<string, unknown> | undefined)?.frequency as SequentialFrequency | undefined) ?? frequency;
  const summaryCustomIntervalValue =
    ((results?.analysis_params as Record<string, unknown> | undefined)?.custom_interval_value as number | null | undefined) ??
    customIntervalValue;
  const rawSummaryCustomIntervalUnit =
    ((results?.analysis_params as Record<string, unknown> | undefined)?.custom_interval_unit as unknown) ??
    customIntervalUnitValue;
  const summaryCustomIntervalUnit: SequentialCustomIntervalUnit | null = isCustomIntervalUnit(
    rawSummaryCustomIntervalUnit,
  )
    ? rawSummaryCustomIntervalUnit
    : null;
  const summaryFrequency = summaryColumnType === 'numeric'
    ? 'Numeric bins'
    : rawSummaryFrequency === 'custom'
      ? summaryCustomIntervalValue && summaryCustomIntervalUnit
        ? `Every ${summaryCustomIntervalValue} ${summaryCustomIntervalUnit}`
        : 'Custom interval'
      : rawSummaryFrequency;
  const minGroupSize = parseNonNegativeIntegerInput(minGroupSizeInput) ?? 0;

  const rawResultRows = Array.isArray(results?.data)
    ? (results.data as Array<Record<string, unknown>>)
    : [];

  const getGroupKey = (row: Record<string, unknown>) => summaryGroupBy
    .map((column) => String(row[column] ?? ''))
    .join(' - ');

  const groupSizeByKey = (() => {
    if (!summaryGroupBy.length) return {} as Record<string, number>;

    const sizes: Record<string, number> = {};
    rawResultRows.forEach((row) => {
      const groupKey = getGroupKey(row);
      const count = row.sequential_count;
      const numericCount = typeof count === 'number' ? count : Number(count ?? 0);
      sizes[groupKey] = (sizes[groupKey] ?? 0) + numericCount;
    });
    return sizes;
  })();

  const passesMinGroupSize = (key: string) => !summaryGroupBy.length || (groupSizeByKey[key] ?? 0) >= minGroupSize;
  const filteredGroupKeys = groupKeys.filter((key) => passesMinGroupSize(key));
  const filteredOutGroupKeys = new Set(groupKeys.filter((key) => !passesMinGroupSize(key)));
  const invisibleGroupKeys = new Set([...hiddenKeys, ...filteredOutGroupKeys]);

  const canDetach = selectedPeriodIndices.size > 0
    && selectedPeriodIndices.size < chartData.length
    && filteredGroupKeys.length > 0;

  const { handleDetach, isDetaching, defaultNodeName } = useSequentialAnalysisDetach({
    currentWorkspaceId,
    resolveTaskId,
    getAuthHeaders,
    panelSelectedNodes,
    chartData,
    results,
    excludedGroupKeys: invisibleGroupKeys,
    selectedPeriodIndices,
    requestedNodeName: detachNodeName,
    queryClient,
  });

  const isRowVisible = (row: Record<string, unknown>) => {
    if (!summaryGroupBy.length) return true;
    return !invisibleGroupKeys.has(getGroupKey(row));
  };

  const getTimeBucketKey = (row: Record<string, unknown>) => String(
    (row.time_period_formatted as string | number | undefined)
      ?? (row.time_period as string | number | undefined)
      ?? '',
  );

  const selectedTimeBucketKeys = new Set(
    Array.from(selectedPeriodIndices)
      .map((index) => String(chartData[index]?.time_period ?? ''))
      .filter((value) => value.length > 0),
  );

  const sumSequentialDocs = (rows: Array<Record<string, unknown>>) => rows.reduce((total, row) => {
    const count = row.sequential_count;
    return total + (typeof count === 'number' ? count : Number(count ?? 0));
  }, 0);

  const shownRows = rawResultRows.filter(isRowVisible);
  const chosenRows = shownRows.filter((row) => selectedTimeBucketKeys.has(getTimeBucketKey(row)));

  const totalPointCount = typeof results?.total_records === 'number'
    ? results.total_records
    : rawResultRows.length;
  const totalDocumentCount = typeof panelSelectedNodes[0]?.shape?.[0] === 'number'
    ? panelSelectedNodes[0].shape[0]
    : sumSequentialDocs(rawResultRows);
  const shownPointCount = shownRows.length;
  const shownDocumentCount = sumSequentialDocs(shownRows);
  const chosenPointCount = selectedPeriodIndices.size > 0 ? chosenRows.length : 0;
  const chosenDocumentCount = selectedPeriodIndices.size > 0 ? sumSequentialDocs(chosenRows) : 0;

  const resultsSummary = summaryTimeColumn
    ? (summaryColumnType === 'numeric'
        ? `Numeric bin counts for ${summaryTimeColumn}`
        : `Frequency of records grouped by ${summaryTimeColumn}`)
    : 'Aggregated frequency over time';

  const handleDownloadChart = async (format: ChartImageFormat) => {
    if (!chartContainerRef.current) {
      toast.error('Chart not available for export.');
      return;
    }
    const svg = findSvgInContainer(chartContainerRef.current);
    if (!svg) {
      toast.error('Chart SVG not found.');
      return;
    }
    const nodeName = panelSelectedNodes[0]?.name ?? panelSelectedNodes[0]?.id ?? 'data';
    const header: ChartExportHeaderItem[] = [
      { label: 'Data Block', value: nodeName },
      { label: 'Time Column', value: summaryTimeColumn || '—' },
      { label: 'Frequency', value: summaryFrequency ?? '—' },
      { label: 'Total', value: `${totalPointCount}/${totalDocumentCount}` },
      { label: 'Shown', value: `${shownPointCount}/${shownDocumentCount}` },
      { label: 'Chosen', value: `${chosenPointCount}/${chosenDocumentCount}` },
      { label: 'Groups', value: summaryGroupBy.length ? summaryGroupBy.join(', ') : 'None' },
    ];
    const legend: ChartExportLegendItem[] = filteredGroupKeys.map((key, idx) => ({
      label: (chartConfig[key]?.label as string | undefined) ?? key,
      color: chartConfig[key]?.color ?? getPaletteColor(idx) ?? '#888888',
      type: chartType === 'line' ? 'line' : chartType === 'bar' ? 'bar' : 'area',
      hidden: hiddenKeys.has(key),
    }));
    try {
      await downloadChartAs(svg, {
        nodeName,
        toolSuffix: 'trends',
        format,
        header,
        legend,
      });
    } catch (err) {
      toast.error('Failed to export chart.');
      console.error(err);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Sequential Analysis
                <InfoIcon
                  targetKey="sequential-analysis.overview"
                  label="About Sequential Analysis"
                  tooltip="Learn what sequential analysis is and how it can help you."
                />
                <HelpIcon
                  targetKey="analysis.sequential-analysis.parameters"
                  label="Sequential analysis parameters"
                  tooltip="Select a time column, choose frequency, and configure group-by options."
                />
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <NodeSelectionPanel
            selectedNodes={panelSelectedNodes}
            nodeColumnSelections={nodeColumnSelections}
            onColumnChange={(nodeId, column) => {
              if (isLocked) return;
              setNodeColumnSelections([{ nodeId, column }]);
              setTimeColumn(column);
            }}
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
                <HelpIcon targetKey="analysis.sequential-analysis.time-column" label="Time column selector" />
              </span>
            )}
            allowedDataTypes={Array.from(TIME_COMPATIBLE_TYPES)}
            lockedMessage={ANALYSIS_LOCKED_MESSAGE}
          />

          {/* Analysis Configuration */}
          <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {derivedColumnType === 'datetime' ? (
              <div className={frequency === 'custom' ? 'md:col-span-2' : 'md:col-span-1'}>
                <div className="mb-1 flex items-center gap-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Frequency
                  </label>
                  <HelpIcon targetKey="analysis.sequential-analysis.frequency" label="Frequency selector" />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={frequency}
                    onValueChange={(value) => setFrequency(value as SequentialFrequency)}
                    disabled={!isLocked && (isAnalyzing || isLoading.operations || !activeNodeId)}
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
                        onChange={(event) => setCustomIntervalValueInput(event.target.value)}
                        placeholder="e.g. 30"
                        className="w-24"
                        disabled={!isLocked && (isAnalyzing || isLoading.operations || !activeNodeId)}
                      />
                      <Select
                        value={customIntervalUnit}
                        onValueChange={(value) => {
                          if (isCustomIntervalUnit(value)) setCustomIntervalUnit(value);
                        }}
                        disabled={!isLocked && (isAnalyzing || isLoading.operations || !activeNodeId)}
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
                    onChange={(event) => setNumericOriginInput(event.target.value)}
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
                    onChange={(event) => setNumericIntervalInput(event.target.value)}
                    placeholder="e.g. 10"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required. Values are bucketed using this interval width.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Group By Columns */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Group By Columns (Optional, max 3)
              </label>
              <Button
                onClick={handleAddGroupByColumn}
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
                  onValueChange={(value) => handleGroupByColumnChange(index, value)}
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
                  onClick={() => handleRemoveGroupByColumn(index)}
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
                  onCheckedChange={(checked) => setCaseSensitive(checked === true)}
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

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              void handleRunOrUpdate();
            }}
            disabled={actionState.runDisabled || isLoading.operations || !activeTimeColumn}
            className="w-full md:w-auto"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                {actionState.runLabel}
              </>
            )}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleClearResults}
              variant="destructive"
              disabled={actionState.clearDisabled}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
            <HelpIcon targetKey="analysis.sequential-analysis.clear-results" label="Clear results" />
          </div>
        </div>
        </CardContent>
      </Card>

      {sequentialWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Sequential Analysis"
          status={sequentialWaitingBanner.status}
          taskId={sequentialWaitingBanner.taskId}
          message={sequentialWaitingBanner.message}
          className="mt-4"
        />
      )}

      {/* Results Display */}
      {results && (
        <Card className="mt-6">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Sequential Analysis Results
                <HelpIcon
                  targetKey="analysis.sequential-analysis.results"
                  label="Sequential analysis results"
                  tooltip={`${resultsSummary}. Review the chart, summaries, and adjust chart type.`}
                />
              </CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Min Group Size</span>
              <Input
                type="number"
                min="0"
                step="1"
                value={minGroupSizeInput}
                onChange={(event) => setMinGroupSizeInput(event.target.value)}
                className="w-24 text-sm"
                aria-label="Min Group Size"
              />
              <span className="text-sm text-muted-foreground">Chart Type</span>
              <Select
                value={chartType}
                onValueChange={(value) => handleChartTypeChange(value as ChartTypeOption)}
              >
                <SelectTrigger className="w-35 text-sm">
                  <SelectValue placeholder="Select chart" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="line">Line Chart</SelectItem>
                  <SelectItem value="bar">Bar Chart</SelectItem>
                  <SelectItem value="area">Area Chart</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                aria-label="Download chart"
                onClick={() => setDownloadDialogOpen(true)}
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Time Column
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {summaryTimeColumn || '—'}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {summaryColumnType === 'numeric' ? 'Numeric Interval' : 'Frequency'}
                </span>
                <div className="mt-1 text-base font-semibold capitalize text-foreground">
                  {summaryColumnType === 'numeric'
                    ? summaryNumericInterval != null
                      ? `${summaryNumericInterval}${summaryNumericOrigin != null ? ` (origin ${summaryNumericOrigin})` : ''}`
                      : '—'
                    : summaryFrequency}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Total
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {`${totalPointCount}/${totalDocumentCount}`}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Shown
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {`${shownPointCount}/${shownDocumentCount}`}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Chosen
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {`${chosenPointCount}/${chosenDocumentCount}`}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Groups
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {summaryGroupBy.length ? summaryGroupBy.join(', ') : 'None'}
                </div>
              </div>
            </div>

            <SequentialChart
              chartType={chartType}
              chartData={chartData}
              chartConfig={chartConfig}
              groupKeys={filteredGroupKeys}
              groupPointCounts={groupPointCounts}
              hiddenKeys={hiddenKeys}
              selectedPeriodIndices={selectedPeriodIndices}
              canDetach={canDetach}
              isDetaching={isDetaching}
              onToggleKey={handleToggleKey}
              onPeriodClick={handlePeriodClick}
              onClearSelection={clearPeriodSelection}
              detachNodeName={detachNodeName}
              detachNodeNamePlaceholder={defaultNodeName}
              onDetachNodeNameChange={setDetachNodeName}
              onDetach={() => {
                void handleDetach();
              }}
              containerRef={chartContainerRef}
            />
          </CardContent>
        </Card>
      )}
      <ChartImageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        title="Download Trends Chart"
        onConfirm={(format) => { void handleDownloadChart(format); }}
      />
    </div>
  );
};

export default SequentialAnalysisFeature;
