/**
 * Trends (sequential-analysis) snapshot load pipeline.
 *
 * Counterpart to ``useSequentialAnalysisSnapshotCapture``: downloads
 * the bundle bytes, decodes the zip via the shared bundle codec,
 * parses the result + settings payloads, and populates
 * ``useSnapshotViewStore`` while flipping the tool's view mode to
 * ``demoSnapshot``.
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
import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';

type SequentialAnalysisRequest = SequentialAnalysisRequestInput;

/** Sequential-analysis-specific payload held by ``LoadedSnapshot.payload``.
 *
 * - ``result`` is the captured raw response (``Record<string, unknown>``)
 *   matching the live UI's ``results`` state shape — fed straight into
 *   the same task-flow derivations that compute ``chartData``,
 *   ``groupKeys``, ``chartConfig``.
 * - ``settings`` is the captured ``SequentialAnalysisRequest`` so the
 *   parameter panel renders the captured time column / frequency /
 *   group-by config in read-only form. Optional: pre-v0.4.5 bundles
 *   didn't carry it. */
export interface SequentialAnalysisSnapshotPayload {
  result: Record<string, unknown>;
  settings?: SequentialAnalysisRequest & { node_id?: string };
}

/** Signals sequential snapshot load failures with reason codes for toasts and tests. */
/**
 * Used by: useSequentialAnalysisSnapshotLoad hook exports or same-file callers because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
 */
export class SequentialAnalysisSnapshotLoadError extends Error {
  /** Preserves the failure reason while retaining the standard Error shape. */
  // Called by: SequentialAnalysisSnapshotLoadError when this analysis object handles its lifecycle work because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'SequentialAnalysisSnapshotLoadError';
  }
}

/** Returns a loader that decodes a sequential-analysis snapshot into snapshot-view state. */
/**
 * Used by: bundle.ts, useSequentialAnalysisSnapshotLoad.test.tsx, useSequentialAnalysisSnapshotCapture.ts, and related files because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
 * Flow: download the snapshot bundle, locate the manifest and payload files, hydrate request/result state, then surface contextual load errors.
 */
export function useSequentialAnalysisSnapshotLoad(): (filename: string) => Promise<void> {
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
        throw new SequentialAnalysisSnapshotLoadError(
          `Could not read snapshot bundle (${readResult.error.kind}).`,
          readResult.error.kind,
        );
      }
      const { manifest, payloadBytes, degradations } = readResult.bundle;
      if (manifest.tool !== 'sequential_analysis') {
        throw new SequentialAnalysisSnapshotLoadError(
          `Snapshot is for tool "${manifest.tool}", not sequential_analysis.`,
          'wrong-tool',
        );
      }

      // Locates payload paths by kind so the loader is resilient to manifest ordering.
      /**
       * Called by: useSequentialAnalysisSnapshotLoad during this analysis workflow because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
       */
      const findPath = (kind: string): string | null =>
        manifest.payloads.find((p) => p.kind === kind)?.path ?? null;

      const resultPath = findPath('result');
      if (!resultPath) {
        throw new SequentialAnalysisSnapshotLoadError(
          'Snapshot bundle has no result payload.',
          'missing-result-payload',
        );
      }
      const resultRaw = payloadBytes.get(resultPath);
      if (!resultRaw) {
        throw new SequentialAnalysisSnapshotLoadError(
          `Snapshot bundle is missing the result file at ${resultPath}.`,
          'missing-result-file',
        );
      }
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(new TextDecoder().decode(resultRaw));
      } catch (err) {
        throw new SequentialAnalysisSnapshotLoadError(
          `Snapshot result payload is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }.`,
          'invalid-result-json',
        );
      }

      let settings: SequentialAnalysisSnapshotPayload['settings'];
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

      const loaded: LoadedSnapshot<SequentialAnalysisSnapshotPayload> = {
        manifest,
        capabilities: manifest.capabilities,
        payload: { result, settings },
        sourceProjection: null,
      };
      loadSnapshotIntoStore('sequential_analysis', loaded, DEMO_SNAPSHOT_MODE);

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
