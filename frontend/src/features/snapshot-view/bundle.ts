/**
 * Bundle codec — read and write the ``.ldaca-snapshot`` zip.
 *
 * Layered on top of the manifest codec (manifest.ts) and JSZip. Result
 * parquet bytes are stored as opaque blobs in the zip; decoding happens
 * lazily via ``decodeResultParquet`` so callers that just want the
 * manifest (e.g. for a "show snapshot info" tooltip) don't pay the
 * parse cost.
 *
 * hyparquet is used for parquet decoding because it avoids wasm-asset loading
 * on Tauri's custom scheme and behind Binder's JupyterServerProxy. If larger
 * result tables need a wasm decoder later, callers can stay behind
 * ``decodeResultParquet``.
 */
import JSZip from 'jszip';
import { parquetQuery } from 'hyparquet';
import {
  applyBuildCapabilityGating,
  emitManifestJson,
  parseManifestJson,
  V1_BUILD_SUPPORT,
  type BuildSupport,
  type ParseDegradation,
  type ParseError,
} from './manifest';
import type { SnapshotManifest, SnapshotPayloadEntry } from './types';

export const MANIFEST_FILE_NAME = 'manifest.json';

/** Inputs needed to write a bundle. ``payloadBytes`` is keyed by the
 * payload entry's ``path`` (e.g. ``"tables/result.parquet"``).
 * JSON-shaped payloads (e.g. dispersion-bins) are also provided as raw
 * bytes — the caller serialises them with ``JSON.stringify`` first.
 * This keeps the bundle codec content-agnostic. */
export interface BundleWriteInput {
  manifest: SnapshotManifest;
  payloadBytes: Map<string, Uint8Array>;
}

/** Bundle read result. Payload bytes are exposed as ``Uint8Array``
 * blobs; callers decode them per-kind (parquet via ``decodeResultParquet``,
 * JSON via ``JSON.parse`` on the UTF-8 text). */
export interface LoadedBundle {
  manifest: SnapshotManifest;
  /** Build-side capability gating applied. UI reads from
   * ``manifest.capabilities`` after this is returned — they are
   * already gated to what the current build supports. */
  degradations: ParseDegradation[];
  /** Raw bytes per payload path. */
  payloadBytes: Map<string, Uint8Array>;
}

export type BundleReadError =
  | { kind: 'zip-parse-failed'; message: string }
  | { kind: 'manifest-missing' }
  | { kind: 'manifest-parse-failed'; error: ParseError }
  | { kind: 'payload-missing'; path: string };

export type BundleReadResult =
  | { ok: true; bundle: LoadedBundle }
  | { ok: false; error: BundleReadError };

/** Write a bundle as a zip ``Uint8Array``. */
export async function writeBundle(input: BundleWriteInput): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(MANIFEST_FILE_NAME, emitManifestJson(input.manifest));

  for (const entry of input.manifest.payloads) {
    const bytes = input.payloadBytes.get(entry.path);
    if (!bytes) {
      throw new Error(
        `writeBundle: payload bytes missing for ${entry.kind} at "${entry.path}". ` +
          `Add an entry to BundleWriteInput.payloadBytes before writing.`,
      );
    }
    // Wrap in a Blob so JSZip's type detection uses its realm-safe
    // ``Object.prototype.toString`` path instead of ``instanceof
    // Uint8Array`` — the latter trips on cross-realm typed arrays
    // (vitest + jsdom in tests; harmless extra wrap in production).
    zip.file(entry.path, new Blob([bytes as BlobPart]));
  }

  return await zip.generateAsync({ type: 'uint8array' });
}

/** Read a bundle. Returns a discriminated result so call sites stay
 * exhaustive. Build-side capability gating is applied here — the
 * returned manifest's capabilities reflect what the build actually
 * supports, with degradations listed for user-visible reporting. */
export async function readBundle(
  data: Uint8Array | ArrayBuffer,
  buildSupport: BuildSupport = V1_BUILD_SUPPORT,
): Promise<BundleReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'zip-parse-failed',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const manifestFile = zip.file(MANIFEST_FILE_NAME);
  if (!manifestFile) {
    return { ok: false, error: { kind: 'manifest-missing' } };
  }
  const manifestText = await manifestFile.async('string');
  const parseRes = parseManifestJson(manifestText);
  if (!parseRes.ok) {
    return { ok: false, error: { kind: 'manifest-parse-failed', error: parseRes.error } };
  }

  const { gated, degradations: gatingDegradations } = applyBuildCapabilityGating(
    parseRes.manifest,
    buildSupport,
  );
  const degradations = [...parseRes.degradations, ...gatingDegradations];

  const payloadBytes = new Map<string, Uint8Array>();
  for (const entry of gated.payloads) {
    const file = zip.file(entry.path);
    if (!file) {
      return { ok: false, error: { kind: 'payload-missing', path: entry.path } };
    }
    payloadBytes.set(entry.path, await file.async('uint8array'));
  }

  return {
    ok: true,
    bundle: { manifest: gated, degradations, payloadBytes },
  };
}

/** Decode a parquet payload's bytes into row records. Tools call this
 * with the result-payload bytes when they need rows in hand; until
 * then the bytes sit unparsed in ``payloadBytes``. */
export async function decodeResultParquet(
  bytes: Uint8Array,
): Promise<Array<Record<string, unknown>>> {
  // hyparquet's parquetQuery accepts an AsyncBuffer; an ArrayBuffer
  // shaped to the parquet file works as the simplest case.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return await parquetQuery({ file: buf });
}

/** Convenience: find the ``result`` payload entry in a manifest.
 * Manifest parse guarantees this exists. */
export function findResultPayload(
  manifest: SnapshotManifest,
): Extract<SnapshotPayloadEntry, { kind: 'result' }> {
  const entry = manifest.payloads.find((p) => p.kind === 'result');
  // The manifest parser fails fatal if missing, so this is unreachable
  // — kept as a runtime guard for hand-constructed manifests in tests.
  if (!entry) {
    throw new Error('findResultPayload: manifest has no result payload');
  }
  return entry as Extract<SnapshotPayloadEntry, { kind: 'result' }>;
}
