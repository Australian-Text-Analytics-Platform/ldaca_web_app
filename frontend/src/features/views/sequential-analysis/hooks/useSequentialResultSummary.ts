import { useMemo } from 'react';

import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';

type SequentialFrequency = NonNullable<SequentialAnalysisRequestInput['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<
  SequentialAnalysisRequestInput['custom_interval_unit']
>;

const VALID_CUSTOM_INTERVAL_UNITS: SequentialCustomIntervalUnit[] = [
  'minutes',
  'hours',
  'days',
  'weeks',
];
// Narrows unknown request values to the custom interval units supported by the UI.
/**
 * Called by: useSequentialResultSummary hook during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 */
const isCustomIntervalUnit = (value: unknown): value is SequentialCustomIntervalUnit =>
  typeof value === 'string' &&
  VALID_CUSTOM_INTERVAL_UNITS.includes(value as SequentialCustomIntervalUnit);

export interface SequentialResultSummary {
  /** Active time/numeric column for the displayed result. */
  timeColumn: string;
  /** Group-by columns the chart is faceted on. */
  groupBy: string[];
  /** Datetime vs numeric mode of the displayed result. */
  columnType: 'datetime' | 'numeric';
  /** Origin value (numeric mode only). */
  numericOrigin: number | null;
  /** Bin width (numeric mode only). */
  numericInterval: number | null;
  /** Raw frequency value (datetime modes); the unprocessed `frequency` request field. */
  rawFrequency: SequentialFrequency;
  /** Custom interval value when `rawFrequency === 'custom'`. */
  customIntervalValue: number | null;
  /** Custom interval unit when `rawFrequency === 'custom'`. */
  customIntervalUnit: SequentialCustomIntervalUnit | null;
  /** Display string: "Numeric bins" / "Every 5 minutes" / "weekly" / etc. */
  frequencyDisplay: string;
}

interface ResultLike {
  analysis_params?: Record<string, unknown>;
}

interface Fallbacks {
  timeColumn: string;
  groupBy: string[];
  columnType: 'datetime' | 'numeric';
  numericOrigin: number | null;
  numericInterval: number | null;
  frequency: SequentialFrequency;
  customIntervalValue: number | null;
  customIntervalUnit: SequentialCustomIntervalUnit | null;
}

/**
 * Derive a "what does this displayed result represent" summary from the
 * server-side `analysis_params` payload, falling back to the live form
 * values when no result has been computed yet.
 *
 * Replaces ~30 lines of `((results?.analysis_params as Record<…>)?.X)
 * ?? localValue` plumbing previously inlined in SequentialAnalysisFeature.
 */
/**
 * Used by: SequentialAnalysisResultsPanel.tsx, SequentialAnalysisFeature.tsx because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export const useSequentialResultSummary = (
  results: ResultLike | null | undefined,
  fallbacks: Fallbacks,
): SequentialResultSummary =>
  useMemo(() => {
    const params = (results?.analysis_params ?? {}) as Record<string, unknown>;

    const timeColumn = (params.time_column as string | undefined) ?? fallbacks.timeColumn;
    const groupBy = (params.group_by_columns as string[] | undefined) ?? fallbacks.groupBy;
    const columnType =
      (params.column_type as 'datetime' | 'numeric' | undefined) ?? fallbacks.columnType;

    const numericOrigin =
      columnType === 'numeric'
        ? ((params.numeric_origin as number | null | undefined) ?? fallbacks.numericOrigin)
        : null;
    const numericInterval =
      columnType === 'numeric'
        ? ((params.numeric_interval as number | null | undefined) ?? fallbacks.numericInterval)
        : null;

    const rawFrequency =
      (params.frequency as SequentialFrequency | undefined) ?? fallbacks.frequency;
    const customIntervalValue =
      (params.custom_interval_value as number | null | undefined) ?? fallbacks.customIntervalValue;
    const rawCustomIntervalUnit = params.custom_interval_unit ?? fallbacks.customIntervalUnit;
    const customIntervalUnit: SequentialCustomIntervalUnit | null = isCustomIntervalUnit(
      rawCustomIntervalUnit,
    )
      ? rawCustomIntervalUnit
      : null;

    const frequencyDisplay =
      columnType === 'numeric'
        ? 'Numeric bins'
        : rawFrequency === 'custom'
          ? customIntervalValue && customIntervalUnit
            ? `Every ${customIntervalValue} ${customIntervalUnit}`
            : 'Custom interval'
          : rawFrequency;

    return {
      timeColumn,
      groupBy,
      columnType,
      numericOrigin,
      numericInterval,
      rawFrequency,
      customIntervalValue,
      customIntervalUnit,
      frequencyDisplay,
    };
  }, [
    results?.analysis_params,
    fallbacks.timeColumn,
    fallbacks.groupBy,
    fallbacks.columnType,
    fallbacks.numericOrigin,
    fallbacks.numericInterval,
    fallbacks.frequency,
    fallbacks.customIntervalValue,
    fallbacks.customIntervalUnit,
  ]);
