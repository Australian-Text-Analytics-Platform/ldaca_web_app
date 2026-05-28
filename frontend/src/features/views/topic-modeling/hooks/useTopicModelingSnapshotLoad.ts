/**
 * Topic-modeling snapshot load pipeline.
 *
 * Counterpart to ``useTopicModelingSnapshotCapture``: downloads the
 * bundle bytes, decodes the zip, parses the result + settings
 * payloads, and populates ``useSnapshotViewStore`` while flipping the
 * tool's view mode to ``demoSnapshot``.
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { downloadSnapshot } from '@/api/generated/sdk.gen';
import { useAuth } from '@/hooks/useAuth';
import {
  DEMO_SNAPSHOT_MODE,
  readBundle,
  useSnapshotViewStore,
  type LoadedSnapshot,
} from '@/features/snapshot-view';
import type { TopicModelingRequestInput, TopicModelingResponse } from '@/api/generated/types.gen';

type TopicModelingRequest = TopicModelingRequestInput;

/** Topic-modeling-specific payload held by ``LoadedSnapshot.payload``.
 *
 * - ``result`` is the captured ``TopicModelingResponse`` — same shape
 *   the live UI reads from ``result`` state. Fed straight into the
 *   chart hooks (``useTopicModelingBubbleChart`` etc.).
 * - ``settings`` is the captured ``TopicModelingRequest`` so the
 *   parameter panel renders the captured node selection / random seed /
 *   topic-size mode/value / sample fractions in read-only mode at load
 *   time. Optional: pre-v0.4.5 bundles didn't carry it. */
export interface TopicModelingSnapshotPayload {
  result: TopicModelingResponse;
  settings?: TopicModelingRequest;
}

/** Signals topic-modeling snapshot load failures with reason codes for toasts and tests. */
/**
 * Used by: useTopicModelingSnapshotLoad hook exports or same-file callers because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
 */
export class TopicModelingSnapshotLoadError extends Error {
  /** Preserves the load failure reason while retaining normal Error behavior. */
  // Called by: TopicModelingSnapshotLoadError when this analysis object handles its lifecycle work because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'TopicModelingSnapshotLoadError';
  }
}

/** Returns a loader that decodes a topic-modeling snapshot into snapshot-view state. */
/**
 * Used by: useTopicModelingBubbleChart.tsx, useTopicModelingSnapshotCapture.ts, useTopicModelingSnapshotLoad.test.tsx, and related files because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
 * Flow: download the snapshot bundle, locate the manifest and payload files, hydrate request/result state, then surface contextual load errors.
 */
export function useTopicModelingSnapshotLoad(): (filename: string) => Promise<void> {
  const { getAuthHeaders } = useAuth();
  const loadSnapshotIntoStore = useSnapshotViewStore((s) => s.loadSnapshot);

  return useCallback(
    async (filename: string): Promise<void> => {
      const headers = getAuthHeaders();
      const { data } = await downloadSnapshot({
        headers,
        parseAs: 'blob',
        path: { filename },
        throwOnError: true,
      });
      const blob = data as Blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const readResult = await readBundle(bytes);
      if (!readResult.ok) {
        throw new TopicModelingSnapshotLoadError(
          `Could not read snapshot bundle (${readResult.error.kind}).`,
          readResult.error.kind,
        );
      }
      const { manifest, payloadBytes, degradations } = readResult.bundle;
      if (manifest.tool !== 'topic_modeling') {
        throw new TopicModelingSnapshotLoadError(
          `Snapshot is for tool "${manifest.tool}", not topic_modeling.`,
          'wrong-tool',
        );
      }

      // Locates payload paths by kind so the loader does not depend on manifest ordering.
      /**
       * Called by: useTopicModelingSnapshotLoad during this analysis workflow because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
       */
      const findPath = (kind: string): string | null =>
        manifest.payloads.find((p) => p.kind === kind)?.path ?? null;

      const resultPath = findPath('result');
      if (!resultPath) {
        throw new TopicModelingSnapshotLoadError(
          'Snapshot bundle has no result payload.',
          'missing-result-payload',
        );
      }
      const resultRaw = payloadBytes.get(resultPath);
      if (!resultRaw) {
        throw new TopicModelingSnapshotLoadError(
          `Snapshot bundle is missing the result file at ${resultPath}.`,
          'missing-result-file',
        );
      }
      let result: TopicModelingResponse;
      try {
        result = JSON.parse(new TextDecoder().decode(resultRaw));
      } catch (err) {
        throw new TopicModelingSnapshotLoadError(
          `Snapshot result payload is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }.`,
          'invalid-result-json',
        );
      }

      let settings: TopicModelingRequest | undefined;
      const settingsPath = findPath('settings');
      if (settingsPath) {
        const settingsRaw = payloadBytes.get(settingsPath);
        if (settingsRaw) {
          try {
            settings = JSON.parse(new TextDecoder().decode(settingsRaw));
          } catch (err) {
            console.warn(
              `Snapshot settings payload at ${settingsPath} is not valid JSON; ParameterPanel will show captured values as blanks.`,
              err,
            );
          }
        }
      }

      const loaded: LoadedSnapshot<TopicModelingSnapshotPayload> = {
        manifest,
        capabilities: manifest.capabilities,
        payload: { result, settings },
        sourceProjection: null,
      };
      loadSnapshotIntoStore('topic_modeling', loaded, DEMO_SNAPSHOT_MODE);

      for (const deg of degradations) {
        if (deg.kind === 'source-projection-unsupported') {
          toast.info(deg.message);
        }
      }

      toast.success(`Loaded snapshot "${manifest.title}".`);
    },
    [getAuthHeaders, loadSnapshotIntoStore],
  );
}
