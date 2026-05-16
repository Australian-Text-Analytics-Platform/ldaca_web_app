/**
 * Trends (sequential-analysis) snapshot capture pipeline.
 *
 * Mirrors the token-frequency hook in shape: no pagination, no
 * materialise step, so the bundle is just the full result payload
 * (the live ``Record<string, unknown>`` that drives the chart) plus
 * the captured ``SequentialAnalysisRequest`` under ``settings.json``.
 */
import { useCallback } from 'react';
import JSZip from 'jszip';
import type { SequentialAnalysisRequest } from '@/api/text';
import { snapshotsApi } from '@/api/snapshots';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import {
  checkSnapshotEligibility,
  emitManifestJson,
  getCurrentAppVersion,
  MANIFEST_FILE_NAME,
  type SnapshotManifest,
} from '@/features/snapshot-view';
import type { WorkspaceNodeLike } from '@/features/analysis/common/nodeSelectionTypes';

const RESULT_PAYLOAD_PATH = 'tables/result.json';
const SETTINGS_PAYLOAD_PATH = 'settings.json';

export interface UseSequentialAnalysisSnapshotCaptureInput {
  workspaceId: string | null;
  workspaceName: string;
  /** Captured request — embedded verbatim in ``settings.json`` so the
   * load flow can rehydrate the time column / frequency / group-by /
   * numeric origin etc. into the read-only parameter panel. */
  request: (SequentialAnalysisRequest & { node_id?: string }) | null;
  /** Full live result, including ``data`` rows + ``analysis_params`` +
   * ``chart_type``. Trends results are bounded by the time bucket count
   * × group count, so the whole payload ships verbatim. */
  results: Record<string, unknown> | null;
  selectedNode: WorkspaceNodeLike | null;
  getNodeRowCount: (node: WorkspaceNodeLike) => number;
  getAuthHeaders: () => Record<string, string>;
}

export interface CaptureError extends Error {
  reason: string;
}

function captureError(reason: string, message: string): CaptureError {
  const err = new Error(message) as CaptureError;
  err.reason = reason;
  return err;
}

function buildSequentialPreview(
  result: Record<string, unknown>,
  request: SequentialAnalysisRequest | null,
): SnapshotManifest['preview'] {
  const data = Array.isArray(result.data) ? (result.data as Array<Record<string, unknown>>) : [];
  const timeBuckets = new Set<string>();
  const groupKeys = new Set<string>();
  const groupingColumns: string[] = (() => {
    const fromParams = (result.analysis_params as Record<string, unknown> | undefined)?.group_by_columns;
    if (Array.isArray(fromParams)) return fromParams.filter((c): c is string => typeof c === 'string');
    if (Array.isArray(request?.group_by_columns)) {
      return request!.group_by_columns!.filter((c): c is string => typeof c === 'string');
    }
    return [];
  })();
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
  // No grouping → one implicit "series" (sequential_count). Match the
  // live chart's behaviour where a single series is rendered when no
  // group-by columns are configured.
  const seriesCount = groupingColumns.length === 0 ? 1 : groupKeys.size;
  const chartType =
    typeof result.chart_type === 'string' ? (result.chart_type as string) : 'line';
  return {
    tool: 'sequential_analysis',
    seriesCount,
    bucketCount: timeBuckets.size,
    chartType,
  };
}

export function useSequentialAnalysisSnapshotCapture(
  input: UseSequentialAnalysisSnapshotCaptureInput,
) {
  const {
    workspaceId,
    workspaceName,
    request,
    results,
    selectedNode,
    getNodeRowCount,
    getAuthHeaders,
  } = input;

  return useCallback(
    async (filename: string, description: string): Promise<void> => {
      if (!selectedNode) {
        throw captureError('no-selection', 'Select a data block first.');
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
      if (!results) {
        throw captureError(
          'no-result',
          'Run the trends analysis (and let it finish) before saving a snapshot.',
        );
      }

      const nodeColours = useNodeColorsStore.getState().colors;
      const nodeId = (selectedNode.id as string | undefined) ?? (selectedNode.node_id as string | undefined) ?? '';
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
        title: filename
          .replace(/^sequential_analysis-/, '')
          .replace(/\.ldaca-snapshot$/, ''),
        source: {
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          node_ids: nodeId ? [nodeId] : [],
          node_labels: nodeId ? [nodeLabel] : [],
          per_block_rows: nodeId ? [rowCount] : [],
          total_source_rows: rowCount,
        },
        capabilities: {
          canPaginate: false,
          canSortAndFilterResult: true,
          canExport: true,
          canFilterSourceRows: false,
          canCrossJump: false,
        },
        preview: buildSequentialPreview(results, request),
        payloads: [
          { kind: 'result', path: RESULT_PAYLOAD_PATH },
          ...(request
            ? ([{ kind: 'settings', path: SETTINGS_PAYLOAD_PATH }] as const)
            : []),
        ],
        node_colors: nodeColorsForSnapshot,
      };

      const zip = new JSZip();
      zip.file(MANIFEST_FILE_NAME, emitManifestJson(manifest));
      zip.file(RESULT_PAYLOAD_PATH, JSON.stringify(results));
      if (request) {
        zip.file(SETTINGS_PAYLOAD_PATH, JSON.stringify(request, null, 2));
      }
      if (description.trim()) {
        zip.file('description.md', description);
      }
      const bundleBytes = await zip.generateAsync({ type: 'uint8array' });

      await snapshotsApi.upload(
        new Blob([bundleBytes as BlobPart], { type: 'application/zip' }),
        filename,
        getAuthHeaders(),
      );
    },
    [
      workspaceId,
      workspaceName,
      request,
      results,
      selectedNode,
      getNodeRowCount,
      getAuthHeaders,
    ],
  );
}
