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
import { concordanceApi } from '@/lib/backend/text/concordance';
import type {
  ConcordanceAnalysisRequest,
  ConcordanceAnalysisResponse,
  ConcordanceDispersionBinsResponse,
} from '@/lib/backend/text/concordance';
import { snapshotsApi } from '@/lib/backend/snapshots';
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
const DISPERSION_BINS_PAYLOAD_PATH = 'tables/dispersion-bins.json';
const SETTINGS_PAYLOAD_PATH = 'settings.json';

export interface UseConcordanceSnapshotCaptureInput {
  workspaceId: string | null;
  workspaceName: string;
  taskId: string;
  /** The actual ``ConcordanceAnalysisRequest`` that produced the
   * current result. Embedded verbatim in the bundle under
   * ``settings.json`` so the load flow can reconstruct the exact
   * form values (search word, regex flag, context widths, node
   * column mapping, etc.) and feed them back into the live
   * <ConcordanceParameterPanel> in read-only mode. */
  request: ConcordanceAnalysisRequest | null;
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
  request: ConcordanceAnalysisRequest | null,
): SnapshotManifest['preview'] {
  const searchTerm = request?.search_word ?? '';
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

      // Fetch the full result via the Phase-0g page_size: 'all' path,
      // and per-node dispersion bins in parallel. The bins endpoint
      // always returns 100 server-side buckets; the snapshot viewer
      // re-aggregates them client-side onto any of
      // DISPERSION_DISPLAY_BIN_COUNTS = [4, 5, 10, 20, 25, 50, 100]
      // so the bin-count selector in the snapshot UI works without
      // re-engaging the backend (concordanceViewModels.ts:182-189).
      //
      // Always force ``combined: false`` here so the response carries
      // per-node entries with their ``materialized: true`` flag,
      // independently of which view mode the user is currently in. If
      // the user was in combined view, we fire a second request with
      // ``combined: true`` below to also capture the ``__COMBINED__``
      // entry — the snapshot then ships both, and the Snapshot view
      // can toggle Separated/Combined locally without re-engaging the
      // backend.
      const validNodeIds = selectedNodes
        .map((n) => n.id ?? (n.node_id as string | undefined))
        .filter((id): id is string => Boolean(id));

      const wasCombined = request?.combined === true;

      const [perNodeResult, combinedResult, ...binResults] = await Promise.all([
        concordanceApi.postConcordanceTaskResult(
          taskId,
          { page_size: 'all', update_only: false, combined: false },
          headers,
        ),
        wasCombined
          ? concordanceApi
              .postConcordanceTaskResult(
                taskId,
                { page_size: 'all', update_only: false, combined: true },
                headers,
              )
              .catch((err: unknown) => {
                // Combined fetch is best-effort — if it fails, the
                // snapshot still ships per-node entries.
                console.warn('Snapshot capture: combined fetch failed', err);
                return null;
              })
          : Promise.resolve(null),
        ...validNodeIds.map((id) =>
          concordanceApi
            .getConcordanceTaskDispersionBins(taskId, id, headers)
            .then(
              (bins) => ({ id, bins }) as { id: string; bins: ConcordanceDispersionBinsResponse },
              (err: unknown) => {
                // Bins are optional — chart degrades gracefully when
                // missing. Log the failure but don't sink the capture.
                console.warn(`Snapshot capture: failed to fetch bins for node ${id}`, err);
                return null;
              },
            ),
        ),
      ]);

      const binsPayload: Record<string, ConcordanceDispersionBinsResponse> = {};
      for (const result of binResults) {
        if (result) binsPayload[result.id] = result.bins;
      }

      // Hard-require materialise (plan §4): the host's disable-reason
      // check already gates the Save button on this, but assert here
      // too so the hook stays self-contained — a captured bundle's
      // result payload must be the flat materialised shape, otherwise
      // the load-side viewer can't render it.
      const unmaterialised = validNodeIds.filter(
        (id) => !perNodeResult.data?.[id]?.materialized,
      );
      if (unmaterialised.length > 0) {
        throw captureError(
          'not-materialised',
          `Process All before saving — ${unmaterialised.length} selected ` +
            `data block${unmaterialised.length === 1 ? '' : 's'} ` +
            `${unmaterialised.length === 1 ? 'has' : 'have'} not been materialised yet.`,
        );
      }

      // Merge per-node + __COMBINED__ entries into a single data map
      // so the snapshot's Separated/Combined tab toggle has both views
      // pre-rendered. ``combinedResult`` only contains __COMBINED__
      // when the user was originally in combined mode.
      const mergedData = { ...perNodeResult.data };
      const combinedEntry = combinedResult?.data?.__COMBINED__;
      if (combinedEntry) mergedData.__COMBINED__ = combinedEntry;
      const fullResult = { ...perNodeResult, data: mergedData };

      // Compose the manifest.
      const nodeColours = useNodeColorsStore.getState().colors;
      const nodeColorsForSnapshot: Record<string, string> = {};
      const nodeIds: string[] = [];
      const nodeLabels: string[] = [];
      const perBlockRows: number[] = [];
      for (const node of selectedNodes) {
        const id = node.id ?? node.node_id;
        if (!id) continue;
        nodeIds.push(id);
        nodeLabels.push(node.name ?? id);
        const rows = getNodeRowCount(node);
        perBlockRows.push(Number.isFinite(rows) ? rows : 0);
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
          per_block_rows: perBlockRows,
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
        payloads: [
          { kind: 'result', path: RESULT_PAYLOAD_PATH },
          { kind: 'dispersion-bins', path: DISPERSION_BINS_PAYLOAD_PATH },
          ...(request
            ? ([{ kind: 'settings', path: SETTINGS_PAYLOAD_PATH }] as const)
            : []),
        ],
        node_colors: nodeColorsForSnapshot,
      };

      // Trim the bundle: ship only what the snapshot viewer renders.
      // ``fullResult.data`` is the per-node ``ConcordanceResultEntry``
      // map — rows + columns + pagination summary + materialised flag,
      // already in the flat shape the viewer expects (we hard-require
      // materialise before save, so every entry is materialised).
      // The wrapper fields (analysis_params, preferences, etc.) are
      // backend metadata the viewer never inspects.
      const zip = new JSZip();
      zip.file(MANIFEST_FILE_NAME, emitManifestJson(manifest));
      zip.file(RESULT_PAYLOAD_PATH, JSON.stringify(fullResult.data ?? {}));
      zip.file(DISPERSION_BINS_PAYLOAD_PATH, JSON.stringify(binsPayload));
      if (request) {
        zip.file(SETTINGS_PAYLOAD_PATH, JSON.stringify(request, null, 2));
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
