/**
 * Token-frequency snapshot capture pipeline.
 *
 * Mirrors the quotation/concordance capture hooks. Token-frequency has
 * no pagination and no materialise step, so the bundle is the simplest
 * of the family — one result payload (the entire ``TokenFrequencyResponse``
 * verbatim) and one settings payload (the ``TokenFrequencyRequest`` that
 * produced it). No per-node parquet pages, no dispersion bins.
 */
import { useCallback } from 'react';
import JSZip from 'jszip';
import type {
  TokenFrequencyRequest,
  TokenFrequencyResponse,
} from '@/api/text';
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

export interface UseTokenFrequencySnapshotCaptureInput {
  workspaceId: string | null;
  workspaceName: string;
  /** The actual ``TokenFrequencyRequest`` (node ids, columns, model)
   * that produced the live ``results``. Embedded verbatim in the
   * bundle under ``settings.json`` so the parameter panel can render
   * the captured node selection and tokeniser at load time. */
  request: TokenFrequencyRequest | null;
  /** Full live response — token-freq's result is already complete (no
   * pagination), so the capture just embeds what the user is looking
   * at. */
  results: TokenFrequencyResponse | null;
  /** The set of nodes whose row counts feed the eligibility check.
   * Order doesn't matter — eligibility looks for the largest. */
  selectedNodes: WorkspaceNodeLike[];
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

function buildTokenFrequencyPreview(
  resp: TokenFrequencyResponse,
  request: TokenFrequencyRequest | null,
): SnapshotManifest['preview'] {
  let vocabSize = 0;
  let topToken = '';
  let topTokenCount = 0;
  const data = resp.data ?? {};
  for (const nodeResult of Object.values(data)) {
    const rows = Array.isArray(nodeResult?.data) ? nodeResult.data : [];
    if (rows.length > vocabSize) vocabSize = rows.length;
    for (const row of rows) {
      const token = typeof row?.token === 'string' ? row.token : '';
      const frequency =
        typeof row?.frequency === 'number' && Number.isFinite(row.frequency)
          ? row.frequency
          : 0;
      if (frequency > topTokenCount) {
        topToken = token;
        topTokenCount = frequency;
      }
    }
  }
  // ``request.model`` only fires when the active node had >1 tokeniser
  // model on the selected source. Otherwise fall back to a generic
  // string — the preview block is informational only.
  const tokeniserId = request?.model ?? '(default)';
  return {
    tool: 'token_frequencies',
    vocabSize,
    topToken,
    topTokenCount,
    tokeniserId,
  };
}

export function useTokenFrequencySnapshotCapture(
  input: UseTokenFrequencySnapshotCaptureInput,
) {
  const {
    workspaceId,
    workspaceName,
    request,
    results,
    selectedNodes,
    getNodeRowCount,
    getAuthHeaders,
  } = input;

  return useCallback(
    async (filename: string, description: string): Promise<void> => {
      if (!selectedNodes.length) {
        throw captureError('no-selection', 'Select a data block first.');
      }
      const perBlockRows = selectedNodes.map((n) => {
        const c = getNodeRowCount(n);
        return Number.isFinite(c) ? c : 0;
      });
      const eligibility = checkSnapshotEligibility({
        mode: 'demo',
        perBlockSourceRows: perBlockRows,
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
      if (!workspaceId) {
        throw captureError('no-workspace', 'Cannot snapshot without an active workspace.');
      }
      if (!results) {
        throw captureError(
          'no-result',
          'Run the token frequency analysis (and let it finish) before saving a snapshot.',
        );
      }
      if (results.state !== 'successful') {
        throw captureError(
          'result-not-ready',
          'Wait for the token frequency analysis to finish before saving a snapshot.',
        );
      }

      const nodeColours = useNodeColorsStore.getState().colors;
      const nodeIds = selectedNodes
        .map((n) => (n.id as string | undefined) ?? (n.node_id as string | undefined) ?? '')
        .filter((id): id is string => Boolean(id));
      const nodeLabels = selectedNodes.map((n, idx) => {
        const id = nodeIds[idx];
        const name = (n.name as string | undefined) ?? id ?? '';
        return name;
      });
      const nodeColorsForSnapshot: Record<string, string> = {};
      for (const id of nodeIds) {
        const colour = nodeColours[id];
        if (colour) nodeColorsForSnapshot[id] = colour;
      }

      const manifest: SnapshotManifest = {
        schema_version: 1,
        mode: 'demo',
        tool: 'token_frequencies',
        tool_version: getCurrentAppVersion() || 'v0.0.0-dev',
        captured_at: new Date().toISOString(),
        title: filename
          .replace(/^token_frequencies-/, '')
          .replace(/\.ldaca-snapshot$/, ''),
        source: {
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          node_ids: nodeIds,
          node_labels: nodeLabels,
          per_block_rows: perBlockRows,
          total_source_rows: perBlockRows.reduce((a, b) => a + b, 0),
        },
        capabilities: {
          canPaginate: false,
          canSortAndFilterResult: true,
          canExport: true,
          canFilterSourceRows: false,
          canCrossJump: false,
        },
        preview: buildTokenFrequencyPreview(results, request),
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
      selectedNodes,
      getNodeRowCount,
      getAuthHeaders,
    ],
  );
}
