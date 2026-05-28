/**
 * Token-frequency snapshot load pipeline.
 *
 * Counterpart to ``useTokenFrequencySnapshotCapture``: downloads the
 * bundle bytes via the snapshots endpoint, decodes the zip via the
 * shared bundle codec, parses the result + settings payloads, and
 * atomically populates ``useSnapshotViewStore`` while flipping the
 * token-frequency tool's view mode to ``demoSnapshot``.
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
import type {
  TokenFrequencyRequestInput,
  TokenFrequencyResponse,
} from '@/api/generated/types.gen';

type TokenFrequencyRequest = TokenFrequencyRequestInput;

/** Token-frequency-specific payload held by ``LoadedSnapshot.payload``.
 *
 * - ``result`` is the captured ``TokenFrequencyResponse`` — same shape
 *   the live UI consumes via the ``results`` state, ready to feed
 *   straight into the normaliser adapters.
 * - ``settings`` is the captured ``TokenFrequencyRequest`` so the load
 *   flow can reconstruct the node selection, column choices, and
 *   reference node. Optional: pre-v0.4.5 bundles didn't carry it. */
export interface TokenFrequencySnapshotPayload {
  result: TokenFrequencyResponse;
  settings?: TokenFrequencyRequest;
}

/** Carries a machine-readable failure reason for token-frequency snapshot loading. */
/**
 * Used by: useTokenFrequencySnapshotLoad hook exports or same-file callers because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
 */
export class TokenFrequencySnapshotLoadError extends Error {
  /** Initializes the snapshot-load error with user-facing text and a stable reason. */
  // Called by: TokenFrequencySnapshotLoadError when this analysis object handles its lifecycle work because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'TokenFrequencySnapshotLoadError';
  }
}

/** Returns the open-snapshot callback that downloads and hydrates token-frequency snapshots. */
/**
 * Used by: useTokenFrequencySnapshotCapture.ts, TokenFrequencyFeature.tsx, useTokenFrequencySnapshotLoad.test.tsx because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
 * Flow: download the snapshot bundle, locate the manifest and payload files, hydrate request/result state, then surface contextual load errors.
 */
export function useTokenFrequencySnapshotLoad(): (filename: string) => Promise<void> {
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
        throw new TokenFrequencySnapshotLoadError(
          `Could not read snapshot bundle (${readResult.error.kind}).`,
          readResult.error.kind,
        );
      }
      const { manifest, payloadBytes, degradations } = readResult.bundle;
      if (manifest.tool !== 'token_frequencies') {
        throw new TokenFrequencySnapshotLoadError(
          `Snapshot is for tool "${manifest.tool}", not token_frequencies.`,
          'wrong-tool',
        );
      }

      /** Finds the payload path for a manifest entry kind inside the loaded bundle. */
      /**
       * Called by: useTokenFrequencySnapshotLoad during this analysis workflow because snapshot loading needs this unit to rebuild saved request/result state from bundled files before hydrating the feature.
       */
      const findPath = (kind: string): string | null =>
        manifest.payloads.find((p) => p.kind === kind)?.path ?? null;

      const resultPath = findPath('result');
      if (!resultPath) {
        throw new TokenFrequencySnapshotLoadError(
          'Snapshot bundle has no result payload.',
          'missing-result-payload',
        );
      }
      const resultRaw = payloadBytes.get(resultPath);
      if (!resultRaw) {
        throw new TokenFrequencySnapshotLoadError(
          `Snapshot bundle is missing the result file at ${resultPath}.`,
          'missing-result-file',
        );
      }
      let result: TokenFrequencyResponse;
      try {
        result = JSON.parse(new TextDecoder().decode(resultRaw));
      } catch (err) {
        throw new TokenFrequencySnapshotLoadError(
          `Snapshot result payload is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }.`,
          'invalid-result-json',
        );
      }

      let settings: TokenFrequencyRequest | undefined;
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

      const loaded: LoadedSnapshot<TokenFrequencySnapshotPayload> = {
        manifest,
        capabilities: manifest.capabilities,
        payload: { result, settings },
        sourceProjection: null,
      };
      loadSnapshotIntoStore('token_frequencies', loaded, DEMO_SNAPSHOT_MODE);

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
