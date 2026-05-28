/**
 * Trends (sequential-analysis) snapshot capture pipeline.
 *
 * Trends captures are **data-rich**: the user picks the finest time
 * bin and which metadata columns to include via
 * <TrendsSnapshotConfigDialog>, and the capture re-runs the backend
 * analysis with those settings before bundling. The viewer (chunks
 * b/c of the plan) re-aggregates the captured rows client-side to
 * coarser frequencies and fewer group dimensions, so the captured
 * payload is the **richest** sliceable view rather than a direct
 * freeze of the current chart.
 *
 * Hard cap: 200,000 rows. Enforced client-side after the re-run
 * returns; the dialog has already shown an estimate so this is a
 * defensive backstop, not the primary gate.
 *
 * Case-sensitive is forced to ``true`` at capture so the viewer's
 * client-side case-folding toggle can merge or split groups without
 * losing the original casings.
 */
import { useCallback } from 'react';
import JSZip from 'jszip';
import { previewSequentialAnalysis, uploadSnapshot } from '@/api/generated/sdk.gen';
import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import {
  checkSnapshotEligibility,
  emitManifestJson,
  getCurrentAppVersion,
  MANIFEST_FILE_NAME,
  type SnapshotManifest,
} from '@/features/snapshot-view';
import type { WorkspaceNodeLike } from '@/features/views/common/nodeSelectionTypes';
import { SNAPSHOT_ROW_HARD_CAP } from '../components/TrendsSnapshotConfigDialog';
import type { TrendsSnapshotConfig } from '../trendsSnapshotConfig';

const RESULT_PAYLOAD_PATH = 'tables/result.json';
const SETTINGS_PAYLOAD_PATH = 'settings.json';
type SequentialAnalysisRequest = SequentialAnalysisRequestInput;

export interface UseSequentialAnalysisSnapshotCaptureInput {
  workspaceId: string | null;
  workspaceName: string;
  /** Live time / numeric column the user is analysing. Captured into
   * the bundle so the viewer's parameter panel renders the same
   * x-axis column. */
  timeColumn: string;
  columnType: 'datetime' | 'numeric';
  selectedNode: WorkspaceNodeLike | null;
  getNodeRowCount: (node: WorkspaceNodeLike) => number;
  getAuthHeaders: () => Record<string, string>;
}

export interface CaptureError extends Error {
  reason: string;
}

/** Creates typed capture errors so the dialog can show precise snapshot failure reasons. */
/**
 * Called by: useSequentialAnalysisSnapshotCapture hook during this analysis workflow because snapshot capture needs this unit to summarize live analysis state before packaging a reusable snapshot.
 */
function captureError(reason: string, message: string): CaptureError {
  const err = new Error(message) as CaptureError;
  err.reason = reason;
  return err;
}

/** Builds the manifest preview summary from captured trends rows and request settings. */
/**
 * Called by: useSequentialAnalysisSnapshotCapture hook as a local helper in this analysis workflow because snapshot capture needs this unit to summarize live analysis state before packaging a reusable snapshot.
 * Flow: scan captured rows for unique periods and group keys, derive series and bucket counts, read chart type, then return snapshot preview metadata.
 */
function buildSequentialPreview(
  result: Record<string, unknown>,
  request: SequentialAnalysisRequest,
): SnapshotManifest['preview'] {
  const data = Array.isArray(result.data) ? (result.data as Array<Record<string, unknown>>) : [];
  const timeBuckets = new Set<string>();
  const groupKeys = new Set<string>();
  const groupingColumns: string[] = Array.isArray(request.group_by_columns)
    ? request.group_by_columns.filter((c): c is string => typeof c === 'string')
    : [];
  for (const row of data) {
    const period =
      (row.time_period_formatted as string | undefined) ??
      (row.time_period as string | undefined) ??
      '';
    if (period) timeBuckets.add(period);
    if (groupingColumns.length) {
      const key = groupingColumns.map((col) => String(row[col] ?? '')).join(' - ');
      groupKeys.add(key);
    }
  }
  const seriesCount = groupingColumns.length === 0 ? 1 : groupKeys.size;
  const chartType = typeof result.chart_type === 'string' ? (result.chart_type as string) : 'line';
  return {
    tool: 'sequential_analysis',
    seriesCount,
    bucketCount: timeBuckets.size,
    chartType,
  };
}

/** Build the ``SequentialAnalysisRequest`` the capture flow sends to
 * the backend. Always emits ``case_sensitive: true`` so the viewer's
 * case-fold toggle can merge variants client-side without information
 * loss. Always uses a preset frequency (never ``custom``) — the
 * dialog enforces this. */
/**
 * Used by: SequentialAnalysisFeature.tsx because snapshot capture needs this unit to summarize live analysis state before packaging a reusable snapshot.
 * Flow: choose numeric or datetime request shape, convert empty group lists to null, force sorted and case-sensitive capture, then return the backend request.
 */
export function buildCaptureRequest(
  timeColumn: string,
  columnType: 'datetime' | 'numeric',
  config: TrendsSnapshotConfig,
): SequentialAnalysisRequest {
  if (columnType === 'numeric') {
    return {
      time_column: timeColumn,
      group_by_columns: config.groupByColumns.length ? config.groupByColumns : null,
      frequency: 'monthly', // unused for numeric; backend ignores
      sort_by_time: true,
      column_type: 'numeric',
      numeric_interval: config.numericInterval,
      numeric_origin: config.numericOrigin,
      case_sensitive: true,
    };
  }
  return {
    time_column: timeColumn,
    group_by_columns: config.groupByColumns.length ? config.groupByColumns : null,
    frequency: config.finestFrequency,
    sort_by_time: true,
    column_type: 'datetime',
    case_sensitive: true,
  };
}

/** Returns the callback that captures sequential-analysis data into a sliceable snapshot bundle. */
/**
 * Used by: useSequentialAnalysisSnapshotLoad.ts, SequentialAnalysisFeature.tsx because snapshot capture needs this unit to summarize live analysis state before packaging a reusable snapshot.
 * Flow: inspect the current result, build preview metadata, serialize the snapshot payload, then hand the bundle data to snapshot actions.
 */
export function useSequentialAnalysisSnapshotCapture(
  input: UseSequentialAnalysisSnapshotCaptureInput,
) {
  const {
    workspaceId,
    workspaceName,
    timeColumn,
    columnType,
    selectedNode,
    getNodeRowCount,
    getAuthHeaders,
  } = input;

  return useCallback(
    async (filename: string, description: string, config: TrendsSnapshotConfig): Promise<void> => {
      if (!selectedNode) {
        throw captureError('no-selection', 'Select a data block first.');
      }
      if (!timeColumn) {
        throw captureError('no-column', 'Pick a time / numeric column before capturing.');
      }
      const rowCount = Number.isFinite(getNodeRowCount(selectedNode))
        ? getNodeRowCount(selectedNode)
        : 0;
      const eligibility = checkSnapshotEligibility({
        mode: 'demo',
        perBlockSourceRows: [rowCount],
        resultRows: 0,
      });
      if (!eligibility.ok && eligibility.reason.kind === 'block-too-large-for-demo') {
        throw captureError(
          'block-too-large',
          `Demo snapshots cap each selected data block at ${eligibility.reason.cap.toLocaleString()} ` +
            `rows. The selected block has ${eligibility.reason.rows.toLocaleString()} rows — ` +
            `pick a smaller block or trim it first.`,
        );
      }
      if (!workspaceId) {
        throw captureError('no-workspace', 'Cannot snapshot without an active workspace.');
      }

      const nodeId =
        (selectedNode.id as string | undefined) ??
        (selectedNode.node_id as string | undefined) ??
        '';
      if (!nodeId) {
        throw captureError('no-node-id', 'Selected data block has no usable identifier.');
      }

      // Re-run the analysis with the dialog-chosen finest granularity.
      // Route through the preview endpoint (``include_data=true``) so
      // the snapshot's config doesn't fight the user's live task for
      // the task-store slot — the live result the user was viewing
      // stays intact and unmodified.
      const captureRequest = buildCaptureRequest(timeColumn, columnType, config);
      const headers = getAuthHeaders();
      const { data: captureResult } = await previewSequentialAnalysis({
        body: captureRequest,
        headers,
        path: { node_id: nodeId },
        query: { include_data: true },
        throwOnError: true,
      });

      const capturedRows = Array.isArray(captureResult.data)
        ? (captureResult.data as Array<Record<string, unknown>>).length
        : 0;
      if (capturedRows > SNAPSHOT_ROW_HARD_CAP) {
        throw captureError(
          'over-row-cap',
          `Capture produced ${capturedRows.toLocaleString()} rows; cap is ${SNAPSHOT_ROW_HARD_CAP.toLocaleString()}. ` +
            `Try a coarser bin or fewer group columns.`,
        );
      }

      const nodeColours = useNodeColorsStore.getState().colors;
      const nodeLabel = (selectedNode.name as string | undefined) ?? nodeId;
      const nodeColorsForSnapshot: Record<string, string> = {};
      const colour = nodeColours[nodeId];
      if (colour) nodeColorsForSnapshot[nodeId] = colour;

      const manifest: SnapshotManifest = {
        schema_version: 1,
        mode: 'demo',
        tool: 'sequential_analysis',
        tool_version: getCurrentAppVersion() || 'v0.0.0-dev',
        captured_at: new Date().toISOString(),
        title: filename.replace(/^sequential_analysis-/, '').replace(/\.ldaca-snapshot$/, ''),
        source: {
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          node_ids: [nodeId],
          node_labels: [nodeLabel],
          per_block_rows: [rowCount],
          total_source_rows: rowCount,
        },
        capabilities: {
          canPaginate: false,
          canSortAndFilterResult: true,
          canExport: true,
          canFilterSourceRows: false,
          canCrossJump: false,
        },
        preview: buildSequentialPreview(captureResult, captureRequest),
        payloads: [
          { kind: 'result', path: RESULT_PAYLOAD_PATH },
          { kind: 'settings', path: SETTINGS_PAYLOAD_PATH },
        ],
        node_colors: nodeColorsForSnapshot,
      };

      const zip = new JSZip();
      zip.file(MANIFEST_FILE_NAME, emitManifestJson(manifest));
      zip.file(RESULT_PAYLOAD_PATH, JSON.stringify(captureResult));
      // Capture the request augmented with ``node_id`` and a snapshot
      // marker so the viewer knows the captured granularity for its
      // re-aggregation constraints.
      const settingsBlob = {
        ...captureRequest,
        node_id: nodeId,
        snapshot_config: {
          finest_frequency: config.finestFrequency,
          group_by_columns: config.groupByColumns,
          numeric_interval: config.numericInterval,
          numeric_origin: config.numericOrigin,
        },
      };
      zip.file(SETTINGS_PAYLOAD_PATH, JSON.stringify(settingsBlob, null, 2));
      if (description.trim()) {
        zip.file('description.md', description);
      }
      const bundleBytes = await zip.generateAsync({ type: 'uint8array' });

      await uploadSnapshot({
        body: {
          file: new Blob([bundleBytes as BlobPart], { type: 'application/zip' }),
          filename,
        },
        headers: getAuthHeaders(),
        throwOnError: true,
      });
    },
    [
      workspaceId,
      workspaceName,
      timeColumn,
      columnType,
      selectedNode,
      getNodeRowCount,
      getAuthHeaders,
    ],
  );
}
