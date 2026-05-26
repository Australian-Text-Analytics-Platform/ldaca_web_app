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
import { snapshotsApi } from '@/lib/backend/snapshots';
import { useAuth } from '@/hooks/useAuth';
import {
  DEMO_SNAPSHOT_MODE,
  readBundle,
  useSnapshotViewStore,
  type LoadedSnapshot,
} from '@/features/snapshot-view';
import type {
  TokenFrequencyRequest,
  TokenFrequencyResponse,
} from '@/lib/backend/text';

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

export class TokenFrequencySnapshotLoadError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'TokenFrequencySnapshotLoadError';
  }
}

export function useTokenFrequencySnapshotLoad(): (filename: string) => Promise<void> {
  const { getAuthHeaders } = useAuth();
  const loadSnapshotIntoStore = useSnapshotViewStore((s) => s.loadSnapshot);

  return useCallback(
    async (filename: string): Promise<void> => {
      const headers = getAuthHeaders();
      const blob = await snapshotsApi.download(filename, headers);
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
