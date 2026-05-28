/**
 * Quotation-specific snapshot capture pipeline.
 *
 * Mirrors the concordance capture hook. Quotation operates on a single node
 * with no combined view, so the bundle is simpler: one result payload and one
 * settings payload, no per-node dispersion bins.
 */
import { useCallback } from 'react';
import JSZip from 'jszip';
import { updateQuotationTaskResult, uploadSnapshot } from '@/api/generated/sdk.gen';
import type {
  QuotationAnalysisResponse,
  QuotationRequestInput,
} from '@/api/generated/types.gen';
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
type QuotationRequest = QuotationRequestInput;

export interface UseQuotationSnapshotCaptureInput {
  workspaceId: string | null;
  workspaceName: string;
  taskId: string;
  /** The actual ``QuotationRequest`` (with node id / column / engine)
   * that produced the current result. Embedded verbatim in the bundle
   * under ``settings.json`` so the live ParameterPanel renders the
   * captured node selection in read-only mode at load time. */
  request: (QuotationRequest & { node_id?: string }) | null;
  /** Live ``materializeSummary`` React-state shape (record_count etc.
   * already snake-cased). When provided, embedded alongside the
   * request in settings.json so the snapshot view's results-card
   * footer can render overall totals — the live UI reads this from
   * the parent task request after Process All, but the materialised
   * page response itself doesn't carry it. */
  materializeSummary: {
    recordCount: number;
    uniqueDocuments: number;
    totalDocuments: number;
  } | null;
  selectedNode: WorkspaceNodeLike | null;
  getNodeRowCount: (node: WorkspaceNodeLike) => number;
  getAuthHeaders: () => Record<string, string>;
  /** Whether the live result has been materialised (Process All clicked). */
  materialized: boolean;
}

export interface CaptureError extends Error {
  reason: string;
}

function captureError(reason: string, message: string): CaptureError {
  const err = new Error(message) as CaptureError;
  err.reason = reason;
  return err;
}

function buildQuotationPreview(
  resp: QuotationAnalysisResponse,
): SnapshotManifest['preview'] {
  const totalHits = resp.pagination?.total_source_rows ?? resp.data?.length ?? 0;
  const displayColumns = Array.isArray(resp.columns) ? resp.columns : [];
  // Quotation extracts opening/closing patterns aren't user-configured
  // (rules are vendored). Keep these fields populated for forward-compat
  // — the preview block is informational only. The captured request
  // carries the column the user picked; the source-block carries that.
  return {
    tool: 'quotation',
    openPattern: '(quotation rules)',
    closePattern: '',
    totalHits,
    displayColumns,
  };
}

export function useQuotationSnapshotCapture(
  input: UseQuotationSnapshotCaptureInput,
) {
  const {
    workspaceId,
    workspaceName,
    taskId,
    request,
    materializeSummary,
    selectedNode,
    getNodeRowCount,
    getAuthHeaders,
    materialized,
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
      if (!taskId) {
        throw captureError(
          'no-task',
          'No saved quotation result yet. Run the extractor (and let it finish) before saving a snapshot.',
        );
      }
      if (!workspaceId) {
        throw captureError('no-workspace', 'Cannot snapshot without an active workspace.');
      }
      if (!materialized) {
        throw captureError(
          'not-materialised',
          'Click Process All before saving — keeps the snapshot compact and avoids the per-document grouping mismatch the unmaterialised shape would carry into the viewer.',
        );
      }

      const headers = getAuthHeaders();

      // Fetch the full result via the page_size: 'all' path. Backend
      // caps at SNAPSHOT_ALL_PAGE_SIZE_CAP (see
      // backend/api/workspaces/analyses/quotation.py).
      const { data: fullResult } = await updateQuotationTaskResult({
        body: { page_size: 'all', update_only: false },
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      if (!('columns' in fullResult)) {
        throw captureError(
          'no-result',
          'No saved quotation result was returned. Run the extractor again before saving a snapshot.',
        );
      }

      // Compose the manifest. Quotation works on one node — list it
      // as the only source, copy its frozen colour into the manifest.
      const nodeColours = useNodeColorsStore.getState().colors;
      const nodeId = selectedNode.id ?? (selectedNode.node_id as string | undefined) ?? '';
      const nodeLabel = (selectedNode.name as string | undefined) ?? nodeId;
      const nodeColorsForSnapshot: Record<string, string> = {};
      const colour = nodeColours[nodeId];
      if (colour) nodeColorsForSnapshot[nodeId] = colour;

      const manifest: SnapshotManifest = {
        schema_version: 1,
        mode: 'demo',
        tool: 'quotation',
        tool_version: getCurrentAppVersion() || 'v0.0.0-dev',
        captured_at: new Date().toISOString(),
        title: filename
          .replace(/^quotation-/, '')
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
          canPaginate: true,
          canSortAndFilterResult: true,
          canExport: true,
          canFilterSourceRows: false,
          canCrossJump: false,
        },
        preview: buildQuotationPreview(fullResult),
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
      zip.file(RESULT_PAYLOAD_PATH, JSON.stringify(fullResult));
      if (request) {
        // Persist materialize_summary alongside the request — the live
        // UI reads it from the parent task's ``materialize_summary``
        // field, and we need an equivalent for the snapshot view's
        // results-card footer to render overall totals.
        const settingsBlob = {
          ...request,
          ...(materializeSummary
            ? {
                materialize_summary: {
                  record_count: materializeSummary.recordCount,
                  unique_documents_with_hits: materializeSummary.uniqueDocuments,
                  total_source_documents: materializeSummary.totalDocuments,
                },
              }
            : {}),
        };
        zip.file(SETTINGS_PAYLOAD_PATH, JSON.stringify(settingsBlob, null, 2));
      }
      if (description.trim()) {
        zip.file('description.md', description);
      }
      const bundleBytes = await zip.generateAsync({ type: 'uint8array' });

      await uploadSnapshot({
        body: {
          file: new Blob([bundleBytes as BlobPart], { type: 'application/zip' }),
          filename,
        },
        headers,
        throwOnError: true,
      });
    },
    [
      workspaceId,
      workspaceName,
      taskId,
      request,
      materializeSummary,
      selectedNode,
      getNodeRowCount,
      getAuthHeaders,
      materialized,
    ],
  );
}
