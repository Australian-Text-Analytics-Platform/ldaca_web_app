/**
 * Topic-modeling snapshot capture pipeline.
 *
 * Mirrors the token-frequency and sequential-analysis hooks: no
 * pagination, so the bundle ships the full ``TopicModelingResponse``
 * verbatim plus the captured ``TopicModelingRequest`` under
 * ``settings.json``. Topic results are bounded by the requested topic
 * count + representative words per topic, so the payload is naturally
 * compact.
 *
 * The re-aggregation backend call (``postTopicModelingTaskResult``
 * with a new ``topic_size_value``) is the load-side counterpart that
 * the load flow must NOT engage — see the feature wiring for the
 * snapshot-mode gates on the Exact Topic No. slider and detach.
 */
import { useCallback } from 'react';
import JSZip from 'jszip';
import type { TopicModelingRequestInput, TopicModelingResponse } from '@/api/generated/types.gen';

type TopicModelingRequest = TopicModelingRequestInput;
import { uploadSnapshot } from '@/api/generated/sdk.gen';
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

export interface UseTopicModelingSnapshotCaptureInput {
  workspaceId: string | null;
  workspaceName: string;
  /** Captured request — embedded verbatim in ``settings.json``. The
   * load flow reads ``node_ids``, ``node_columns``, ``random_seed``,
   * ``representative_words_count``, ``topic_size_mode/value``,
   * ``sample_fractions`` back into the parameter-panel state. */
  request: TopicModelingRequest | null;
  /** Full live result — chart-ready ``topics`` + ``corpus_sizes`` +
   * ``per_corpus_topic_counts`` + ``meta``. Captured verbatim. */
  results: TopicModelingResponse | null;
  /** The set of nodes whose row counts feed the eligibility check. */
  selectedNodes: WorkspaceNodeLike[];
  getNodeRowCount: (node: WorkspaceNodeLike) => number;
  getAuthHeaders: () => Record<string, string>;
}

export interface CaptureError extends Error {
  reason: string;
}

/** Creates typed capture errors so snapshot UI can show precise failure reasons. */
/**
 * Called by: useTopicModelingSnapshotCapture hook during this analysis workflow because snapshot capture needs this unit to summarize live analysis state before packaging a reusable snapshot.
 */
function captureError(reason: string, message: string): CaptureError {
  const err = new Error(message) as CaptureError;
  err.reason = reason;
  return err;
}

/** Builds the topic-modeling preview block shown in snapshot load dialogs. */
/**
 * Called by: useTopicModelingSnapshotCapture hook as a local helper in this analysis workflow because snapshot capture needs this unit to summarize live analysis state before packaging a reusable snapshot.
   * Flow: count topics, collect unique representative words as a vocabulary proxy, set the model label and words-per-topic, then return preview metadata.
 */
function buildTopicModelingPreview(
  result: TopicModelingResponse,
  request: TopicModelingRequest | null,
): SnapshotManifest['preview'] {
  const topics = result.data?.topics ?? [];
  const numTopics = topics.length;
  // Vocab proxy: count unique representative words across topics.
  // Captures "richness" of the model output for the load dialog
  // summary without decoding the full payload.
  const vocab = new Set<string>();
  for (const topic of topics) {
    if (Array.isArray(topic.representative_words)) {
      for (const word of topic.representative_words) {
        if (typeof word === 'string') vocab.add(word);
      }
    }
  }
  // The backend doesn't expose its embedder name in the result; until
  // it does, mark the bundle as "bertopic" (the model framework). The
  // preview block is informational only.
  const embedder = 'bertopic';
  const wordsPerTopic =
    typeof request?.representative_words_count === 'number'
      ? request.representative_words_count
      : 15;
  return {
    tool: 'topic_modeling',
    numTopics,
    vocabSize: vocab.size,
    embedder,
    wordsPerTopic,
  };
}

/** Returns the callback that packages the current topic-modeling result into a snapshot bundle. */
/**
 * Used by: TopicModelingFeature.tsx, useTopicModelingSnapshotLoad.ts because snapshot capture needs this unit to summarize live analysis state before packaging a reusable snapshot.
 * Flow: inspect the current result, build preview metadata, serialize the snapshot payload, then hand the bundle data to snapshot actions.
 */
export function useTopicModelingSnapshotCapture(
  input: UseTopicModelingSnapshotCaptureInput,
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
          'Run the topic modelling analysis (and let it finish) before saving a snapshot.',
        );
      }
      if (results.state !== 'successful') {
        throw captureError(
          'result-not-ready',
          'Wait for the topic modelling analysis to finish before saving a snapshot.',
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
        tool: 'topic_modeling',
        tool_version: getCurrentAppVersion() || 'v0.0.0-dev',
        captured_at: new Date().toISOString(),
        title: filename
          .replace(/^topic_modeling-/, '')
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
        preview: buildTopicModelingPreview(results, request),
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
      request,
      results,
      selectedNodes,
      getNodeRowCount,
      getAuthHeaders,
    ],
  );
}
