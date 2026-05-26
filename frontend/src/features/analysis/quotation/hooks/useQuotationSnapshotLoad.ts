/**
 * Quotation snapshot load pipeline.
 *
 * Counterpart to ``useQuotationSnapshotCapture``: downloads the bundle
 * bytes via the snapshots endpoint, decodes the zip via the shared
 * bundle codec, parses the result + settings payloads, and atomically
 * populates ``useSnapshotViewStore`` while flipping the quotation
 * tool's view mode to ``demoSnapshot``.
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
  QuotationAnalysisResponse,
  QuotationRequest,
} from '@/lib/backend/text/quotation';

/** Materialise summary that mirrors the live ``materializeSummary``
 * React state — total hit count, unique documents with hits, and total
 * source documents processed. Captured into the bundle so the snapshot
 * view's results-card footer can show the same "Found N instances in
 * M documents…" line the user sees right after Process All. */
export interface QuotationMaterializeSummary {
  record_count: number;
  unique_documents_with_hits: number;
  total_source_documents: number;
}

/** Quotation-specific payload held by ``LoadedSnapshot.payload``.
 *
 * - ``result`` is the captured ``QuotationAnalysisResponse`` — same
 *   shape the live UI reads from ``resultsByNode[id]``, ready to feed
 *   straight into ``buildQuotationResultState``.
 * - ``settings`` is the captured ``QuotationRequest`` so the load flow
 *   can reconstruct the node selection + column / engine config.
 *   Carries ``materialize_summary`` alongside so the results-card
 *   footer can show overall totals (live mode reads them from the
 *   parent task request; snapshot mode reads them from here).
 *   Optional: pre-v0.4.5 bundles didn't carry it. */
export interface QuotationSnapshotPayload {
  result: QuotationAnalysisResponse;
  settings?: QuotationRequest & {
    node_id?: string;
    materialize_summary?: QuotationMaterializeSummary;
  };
}

export class QuotationSnapshotLoadError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'QuotationSnapshotLoadError';
  }
}

export function useQuotationSnapshotLoad(): (filename: string) => Promise<void> {
  const { getAuthHeaders } = useAuth();
  const loadSnapshotIntoStore = useSnapshotViewStore((s) => s.loadSnapshot);

  return useCallback(
    async (filename: string): Promise<void> => {
      const headers = getAuthHeaders();
      const blob = await snapshotsApi.download(filename, headers);
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const readResult = await readBundle(bytes);
      if (!readResult.ok) {
        throw new QuotationSnapshotLoadError(
          `Could not read snapshot bundle (${readResult.error.kind}).`,
          readResult.error.kind,
        );
      }
      const { manifest, payloadBytes, degradations } = readResult.bundle;
      if (manifest.tool !== 'quotation') {
        throw new QuotationSnapshotLoadError(
          `Snapshot is for tool "${manifest.tool}", not quotation.`,
          'wrong-tool',
        );
      }

      const findPath = (kind: string): string | null =>
        manifest.payloads.find((p) => p.kind === kind)?.path ?? null;

      const resultPath = findPath('result');
      if (!resultPath) {
        throw new QuotationSnapshotLoadError(
          'Snapshot bundle has no result payload.',
          'missing-result-payload',
        );
      }
      const resultRaw = payloadBytes.get(resultPath);
      if (!resultRaw) {
        throw new QuotationSnapshotLoadError(
          `Snapshot bundle is missing the result file at ${resultPath}.`,
          'missing-result-file',
        );
      }
      let result: QuotationAnalysisResponse;
      try {
        result = JSON.parse(new TextDecoder().decode(resultRaw));
      } catch (err) {
        throw new QuotationSnapshotLoadError(
          `Snapshot result payload is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }.`,
          'invalid-result-json',
        );
      }

      let settings: QuotationSnapshotPayload['settings'];
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

      const loaded: LoadedSnapshot<QuotationSnapshotPayload> = {
        manifest,
        capabilities: manifest.capabilities,
        payload: { result, settings },
        sourceProjection: null,
      };
      loadSnapshotIntoStore('quotation', loaded, DEMO_SNAPSHOT_MODE);

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
