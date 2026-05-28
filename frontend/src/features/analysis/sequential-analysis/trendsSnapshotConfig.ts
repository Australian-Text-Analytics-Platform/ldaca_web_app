import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';

type SequentialFrequency = NonNullable<SequentialAnalysisRequestInput['frequency']>;

export type SnapshotFinestFrequency = Exclude<SequentialFrequency, 'custom'>;

export interface TrendsSnapshotConfig {
  finestFrequency: SnapshotFinestFrequency;
  groupByColumns: string[];
  numericInterval: number;
  numericOrigin: number | null;
}

export const DEFAULT_TRENDS_SNAPSHOT_CONFIG: TrendsSnapshotConfig = {
  finestFrequency: 'daily',
  groupByColumns: [],
  numericInterval: 1,
  numericOrigin: null,
};

export const SNAPSHOT_FINEST_FREQUENCIES: readonly SnapshotFinestFrequency[] = [
  'second',
  'minute',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];
