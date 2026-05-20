import type { SequentialFrequency } from '@/api/text';

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