/**
 * Concordance snapshot load pipeline (plan §5.1 — Loader section).
 *
 * Counterpart to ``useConcordanceSnapshotCapture``: downloads the
 * bundle bytes via the Phase-0h ``GET /users/me/snapshots/{filename}``
 * endpoint, decodes the zip via the shared bundle codec (Phase 0c),
 * parses the per-node result + bins payloads, and atomically
 * populates ``useSnapshotViewStore`` while flipping the concordance
 * tool's view mode to ``demoSnapshot``.
 *
 * The downstream rendering (dual-source result panel + dispersion
 * chart) lands in Phase 1b-2b — this hook gets the data into the
 * store and the banner up, so the user has a clear signal that
 * "you're now viewing snapshot X" before the full view wires in.
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { snapshotsApi } from '@/api/snapshots';
import { useAuth } from '@/hooks/useAuth';
import {
  DEMO_SNAPSHOT_MODE,
  readBundle,
  useSnapshotViewStore,
  type LoadedSnapshot,
} from '@/features/snapshot-view';
import type {
  ConcordanceDispersionBinsResponse,
  ConcordanceResultEntry,
} from '@/api/text/concordance';

/** Concordance-specific payload held by ``LoadedSnapshot.payload``.
 * Mirrors the live UI's data shape so the dual-source readers in
 * Phase 1b-2b can plug it in with minimal adaptation:
 *
 * - ``resultByNodeId`` is exactly what
 *   ``ConcordanceAnalysisResponse.data`` is in live mode — a
 *   per-node ``ConcordanceResultEntry`` map.
 * - ``binsByNodeId`` is the per-node bin response captured at save
 *   time. Empty entries when the per-node bins fetch failed at
 *   capture (chart degrades to no-data for that node). */
export interface ConcordanceSnapshotPayload {
  resultByNodeId: Record<string, ConcordanceResultEntry>;
  binsByNodeId: Record<string, ConcordanceDispersionBinsResponse>;
}

export class ConcordanceSnapshotLoadError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'ConcordanceSnapshotLoadError';
  }
}

/** Hook factory: returns an async ``(filename) => void`` that the
 * load dialog wires into ``SnapshotActions.onOpenSnapshot``. On
 * success the store is populated and the view mode flips; on
 * failure throws (the load dialog surfaces the message as a
 * destructive toast). */
export function useConcordanceSnapshotLoad(): (filename: string) => Promise<void> {
  const { getAuthHeaders } = useAuth();
  const loadSnapshotIntoStore = useSnapshotViewStore((s) => s.loadSnapshot);

  return useCallback(
    async (filename: string): Promise<void> => {
      const headers = getAuthHeaders();

      // Download bytes via Phase-0h endpoint.
      const blob = await snapshotsApi.download(filename, headers);
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // Decode zip + manifest. ``readBundle`` applies build-side
      // capability gating (Mode-2a graceful degrade), so a future-mode
      // bundle loads with capabilities gated down rather than failing.
      const readResult = await readBundle(bytes);
      if (!readResult.ok) {
        throw new ConcordanceSnapshotLoadError(
          `Could not read snapshot bundle (${readResult.error.kind}).`,
          readResult.error.kind,
        );
      }
      const { manifest, payloadBytes, degradations } = readResult.bundle;

      if (manifest.tool !== 'concordance') {
        throw new ConcordanceSnapshotLoadError(
          `Snapshot is for tool "${manifest.tool}", not concordance.`,
          'wrong-tool',
        );
      }

      // Dispatch payloads by manifest ``kind`` (not file path — paths
      // are advisory and a future bundle may use different ones).
      const findPath = (kind: string): string | null =>
        manifest.payloads.find((p) => p.kind === kind)?.path ?? null;

      const resultPath = findPath('result');
      if (!resultPath) {
        throw new ConcordanceSnapshotLoadError(
          'Snapshot bundle has no result payload.',
          'missing-result-payload',
        );
      }
      const resultRaw = payloadBytes.get(resultPath);
      if (!resultRaw) {
        throw new ConcordanceSnapshotLoadError(
          `Snapshot bundle is missing the result file at ${resultPath}.`,
          'missing-result-file',
        );
      }
      let resultByNodeId: Record<string, ConcordanceResultEntry>;
      try {
        resultByNodeId = JSON.parse(new TextDecoder().decode(resultRaw));
      } catch (err) {
        throw new ConcordanceSnapshotLoadError(
          `Snapshot result payload is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }.`,
          'invalid-result-json',
        );
      }

      // Bins are optional — viewer renders "no data" for missing nodes.
      let binsByNodeId: Record<string, ConcordanceDispersionBinsResponse> = {};
      const binsPath = findPath('dispersion-bins');
      if (binsPath) {
        const binsRaw = payloadBytes.get(binsPath);
        if (binsRaw) {
          try {
            binsByNodeId = JSON.parse(new TextDecoder().decode(binsRaw));
          } catch (err) {
            console.warn(
              `Snapshot bins payload at ${binsPath} is not valid JSON; chart will show no data.`,
              err,
            );
          }
        }
      }

      // Build the LoadedSnapshot and populate the store atomically
      // with the mode flip — see useSnapshotViewStore.loadSnapshot.
      const loaded: LoadedSnapshot<ConcordanceSnapshotPayload> = {
        manifest,
        capabilities: manifest.capabilities,
        payload: { resultByNodeId, binsByNodeId },
        sourceProjection: null,
      };
      loadSnapshotIntoStore('concordance', loaded, DEMO_SNAPSHOT_MODE);

      // Surface gating notices (e.g. share-mode capability downgrade
      // when a Mode-2a bundle is opened in a v1 build) as info toasts.
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
