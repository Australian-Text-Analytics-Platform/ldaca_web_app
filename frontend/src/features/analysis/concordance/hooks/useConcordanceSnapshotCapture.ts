/**
 * Concordance-specific snapshot capture pipeline.
 *
 * Phase 1a-2 (plan §5.1). Assembles a snapshot bundle from the
 * concordance feature's in-memory state plus a full-result fetch
 * via the Phase-0g ``page_size: "all"`` path. The hook returns a
 * single async function that the shared <AnalysisFeatureHeader>'s
 * onSaveSnapshot prop calls.
 *
 * Scope note: the v1 ships a minimum-viable capture — manifest +
 * full result rows. Dispersion bins, materialise summaries, and
 * local UI state (chart settings, current tab, expanded rows) are
 * tracked in plan §5.1 but ride along in Phase 2 polish as the
 * load-side rendering matures and uncovers what the bundle has to
 * actually carry. Round-trip parity stays the goal; this commit
 * lands the capture-side rail.
 */
import { useCallback } from 'react';
import JSZip from 'jszip';
import { concordanceApi } from '@/api/text/concordance';
import type { ConcordanceAnalysisResponse } from '@/api/text/concordance';
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

export interface UseConcordanceSnapshotCaptureInput {
  workspaceId: string | null;
  workspaceName: string;
  taskId: string;
  /** Snapshot of the in-memory request that produced the current
   * result. Embedded verbatim in the bundle under ``settings.json``
   * so the load flow can reconstruct the exact form values. */
  request: Record<string, unknown> | null;
  selectedNodes: readonly WorkspaceNodeLike[];
  /** Returns total rows for a selected node. Each block is checked
   * independently against ``SNAPSHOT_CAPS.demo.maxSourceRowsPerBlock``
   * (2 000) — multi-block captures are fine as long as each block is
   * teaching-sized. */
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

function perBlockRowCounts(
  nodes: readonly WorkspaceNodeLike[],
  getCount: (n: WorkspaceNodeLike) => number,
): number[] {
  return nodes.map((n) => (Number.isFinite(getCount(n)) ? getCount(n) : 0));
}

function buildConcordancePreview(
  resp: ConcordanceAnalysisResponse,
  request: Record<string, unknown> | null,
): SnapshotManifest['preview'] {
  const searchTerm = (request?.search_word as string | undefined) ?? '';
  let totalHits = 0;
  let displayColumns: string[] = [];
  let materialised = false;
  for (const entry of Object.values(resp.data)) {
    totalHits += entry.pagination?.total_source_rows ?? entry.data?.length ?? 0;
    if (entry.materialized) materialised = true;
    if (displayColumns.length === 0 && Array.isArray(entry.columns)) {
      displayColumns = entry.columns;
    }
  }
  return {
    tool: 'concordance',
    searchTerm,
    totalHits,
    materialised,
    displayColumns,
  };
}

export function useConcordanceSnapshotCapture(
  input: UseConcordanceSnapshotCaptureInput,
) {
  const {
    workspaceId,
    workspaceName,
    taskId,
    request,
    selectedNodes,
    getNodeRowCount,
    getAuthHeaders,
  } = input;

  return useCallback(
    async (filename: string, description: string): Promise<void> => {
      // Eligibility check FIRST so users see the right reason when
      // multiple guards would reject. The 2 000-row per-block cap is
      // the most common rejection; the task-id / workspace checks
      // below catch edge cases the user can't directly act on.
      const blockRowCounts = perBlockRowCounts(selectedNodes, getNodeRowCount);
      const totalSourceRows = blockRowCounts.reduce((s, n) => s + n, 0);
      const eligibility = checkSnapshotEligibility({
        mode: 'demo',
        perBlockSourceRows: blockRowCounts,
        // Result-row cap can't be known until we fetch; rely on the
        // server-side hard cap. ``checkSnapshotEligibility`` here only
        // gates the per-block source-row side (2 000).
        resultRows: 0,
      });
      if (!eligibility.ok && eligibility.reason.kind === 'block-too-large-for-demo') {
        throw captureError(
          'block-too-large',
          `Demo snapshots cap each selected data block at ${eligibility.reason.cap.toLocaleString()} ` +
            `rows. The largest selected block has ${eligibility.reason.rows.toLocaleString()} rows — ` +
            `pick a smaller block or trim it first.`,
        );
      }

      if (!taskId) {
        throw captureError(
          'no-task',
          'No saved concordance result available yet. Run the analysis (and let it finish) before saving a snapshot.',
        );
      }
      if (!workspaceId) {
        throw captureError('no-workspace', 'Cannot snapshot without an active workspace.');
      }

      const headers = getAuthHeaders();

      // Fetch the full result via the Phase-0g page_size: 'all' path.
      // The backend caps at 500k, so for valid demo captures this is
      // the entire result table in one round-trip.
      const fullResult = await concordanceApi.postConcordanceTaskResult(
        taskId,
        { page_size: 'all', update_only: false },
        headers,
      );

      // Compose the manifest.
      const nodeColours = useNodeColorsStore.getState().colors;
      const nodeColorsForSnapshot: Record<string, string> = {};
      const nodeIds: string[] = [];
      const nodeLabels: string[] = [];
      for (const node of selectedNodes) {
        const id = node.id ?? node.node_id;
        if (!id) continue;
        nodeIds.push(id);
        nodeLabels.push(node.name ?? id);
        const colour = nodeColours[id];
        if (colour) nodeColorsForSnapshot[id] = colour;
      }

      const manifest: SnapshotManifest = {
        schema_version: 1,
        mode: 'demo',
        tool: 'concordance',
        tool_version: getCurrentAppVersion() || 'v0.0.0-dev',
        captured_at: new Date().toISOString(),
        title: filename
          .replace(/^concordance-/, '')
          .replace(/\.ldaca-snapshot$/, ''),
        source: {
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          node_ids: nodeIds,
          node_labels: nodeLabels,
          total_source_rows: totalSourceRows,
        },
        capabilities: {
          canPaginate: true,
          canSortAndFilterResult: true,
          canExport: true,
          canFilterSourceRows: false,
          canCrossJump: false,
        },
        preview: buildConcordancePreview(fullResult, request),
        payloads: [{ kind: 'result', path: RESULT_PAYLOAD_PATH }],
        node_colors: nodeColorsForSnapshot,
      };

      // Assemble the zip bundle directly here. JSON is fine for v1
      // result rows — demo caps source at 2 000 rows so result tables
      // are typically a few thousand entries at most. Switching to
      // parquet bytes (already supported by the manifest's `kind:
      // result` entry) is a Phase-2 size optimisation.
      const zip = new JSZip();
      zip.file(MANIFEST_FILE_NAME, emitManifestJson(manifest));
      // Store the entire result payload — captured exactly as the
      // backend served it. ``settings.json`` mirrors the in-flight
      // request so the load flow can re-hydrate the form.
      zip.file(
        RESULT_PAYLOAD_PATH,
        JSON.stringify({ analysis_response: fullResult }),
      );
      if (request) {
        zip.file('settings.json', JSON.stringify(request, null, 2));
      }
      if (description.trim()) {
        zip.file('description.md', description);
      }
      const bundleBytes = await zip.generateAsync({ type: 'uint8array' });

      // Upload via the Phase-0h endpoints. The backend extracts the
      // sidecar manifest + autogenerates the .md description sidecar
      // automatically.
      await snapshotsApi.upload(
        new Blob([bundleBytes as BlobPart], { type: 'application/zip' }),
        filename,
        headers,
      );
    },
    [
      workspaceId,
      workspaceName,
      taskId,
      request,
      selectedNodes,
      getNodeRowCount,
      getAuthHeaders,
    ],
  );
}
