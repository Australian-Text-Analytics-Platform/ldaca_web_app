/**
 * Manifest codec — parse and emit ``manifest.json`` for the snapshot
 * bundle.
 *
 * The codec is intentionally lenient on additive shape changes
 * (unknown payload kinds load with a console warn) and strict on
 * required structure (missing result payload, bad schema_version,
 * malformed required fields are fatal). This matches the plan §2.1
 * "loader rules" and keeps Mode 2a bundles forward-compatible with
 * v1 builds — see §5.6 and §10.3 of the plan.
 *
 * The codec returns discriminated results instead of throwing so call
 * sites stay typesafe and exhaustive.
 */
import type {
  SnapshotCapabilities,
  SnapshotManifest,
  SnapshotMode,
  SnapshotPayloadEntry,
  SnapshotPreview,
  SnapshotToolKey,
} from './types';

const VALID_MODES: readonly SnapshotMode[] = ['demo', 'share'];
const VALID_TOOLS: readonly SnapshotToolKey[] = [
  'concordance',
  'quotation',
  'token_frequencies',
  'sequential_analysis',
  'topic_modeling',
];
const KNOWN_PAYLOAD_KINDS = new Set<SnapshotPayloadEntry['kind']>([
  'result',
  'dispersion-bins',
  'source-projection',
  'settings',
]);

/** Build-side capability advertisement. v1 declares which optional
 * snapshot features its UI supports; the loader gates manifests
 * accordingly. */
export interface BuildSupport {
  /** Build can render the source-row inspector and decode the
   * source-projection parquet. v1: false. */
  supportsSourceProjection: boolean;
  /** Build can perform cross-tool jumps from inside a snapshot
   * (requires a multi-tool snapshot, not in v1). */
  supportsCrossJump: boolean;
}

/** What the current build supports. Tightens to true as features
 * land. */
export const V1_BUILD_SUPPORT: BuildSupport = {
  supportsSourceProjection: false,
  supportsCrossJump: false,
};

export type ParseError =
  | { kind: 'invalid-json'; message: string }
  | { kind: 'not-an-object' }
  | { kind: 'missing-required-field'; field: string }
  | { kind: 'invalid-field-type'; field: string; expected: string }
  | { kind: 'unsupported-schema-version'; version: unknown }
  | { kind: 'unknown-mode'; value: unknown }
  | { kind: 'unknown-tool'; value: unknown }
  | { kind: 'missing-result-payload' };

export type ParseDegradation =
  | {
      kind: 'unknown-payload-kind';
      rawKind: string;
      path?: string;
    }
  | {
      /** Build can't open the source-row inspector for this bundle —
       * shown as a notice in the snapshot's banner. */
      kind: 'source-projection-unsupported';
      message: string;
    }
  | { kind: 'cross-jump-unsupported' };

export type ParseResult =
  | { ok: true; manifest: SnapshotManifest; degradations: ParseDegradation[] }
  | { ok: false; error: ParseError };

/** Parse raw manifest JSON text into a typed manifest. */
export function parseManifestJson(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'invalid-json',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  return parseManifest(parsed);
}

/** Parse an already-decoded JSON value. Split out so callers that
 * have the parsed JSON in hand don't double-decode. */
export function parseManifest(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { kind: 'not-an-object' } };
  }
  const obj = raw as Record<string, unknown>;

  const schemaVersion = obj.schema_version;
  if (schemaVersion !== 1) {
    return {
      ok: false,
      error: { kind: 'unsupported-schema-version', version: schemaVersion },
    };
  }

  const mode = obj.mode;
  if (!VALID_MODES.includes(mode as SnapshotMode)) {
    return { ok: false, error: { kind: 'unknown-mode', value: mode } };
  }

  const tool = obj.tool;
  if (!VALID_TOOLS.includes(tool as SnapshotToolKey)) {
    return { ok: false, error: { kind: 'unknown-tool', value: tool } };
  }

  for (const field of ['tool_version', 'captured_at', 'title'] as const) {
    if (typeof obj[field] !== 'string') {
      return {
        ok: false,
        error: { kind: 'invalid-field-type', field, expected: 'string' },
      };
    }
  }

  const sourceErr = validateSourceBlock(obj.source);
  if (sourceErr) return { ok: false, error: sourceErr };

  const capsErr = validateCapabilities(obj.capabilities);
  if (capsErr) return { ok: false, error: capsErr };

  const preview = obj.preview;
  if (
    typeof preview !== 'object' ||
    preview === null ||
    Array.isArray(preview) ||
    typeof (preview as Record<string, unknown>).tool !== 'string'
  ) {
    return {
      ok: false,
      error: { kind: 'invalid-field-type', field: 'preview', expected: 'object with tool' },
    };
  }

  const nodeColors = obj.node_colors;
  if (
    typeof nodeColors !== 'object' ||
    nodeColors === null ||
    Array.isArray(nodeColors)
  ) {
    return {
      ok: false,
      error: { kind: 'invalid-field-type', field: 'node_colors', expected: 'object' },
    };
  }

  if (!Array.isArray(obj.payloads)) {
    return {
      ok: false,
      error: { kind: 'invalid-field-type', field: 'payloads', expected: 'array' },
    };
  }

  const degradations: ParseDegradation[] = [];
  const payloads: SnapshotPayloadEntry[] = [];
  for (const entry of obj.payloads) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const kind = e.kind;
    if (typeof kind !== 'string' || typeof e.path !== 'string') continue;
    if (!KNOWN_PAYLOAD_KINDS.has(kind as SnapshotPayloadEntry['kind'])) {
      degradations.push({
        kind: 'unknown-payload-kind',
        rawKind: kind,
        path: e.path,
      });
      continue;
    }
    if (kind === 'source-projection') {
      if (!Array.isArray(e.columns) || !e.columns.every((c) => typeof c === 'string')) {
        // Malformed source-projection entry — treat as if it were unknown
        // so we don't crash, but record the degradation.
        degradations.push({ kind: 'unknown-payload-kind', rawKind: kind, path: e.path });
        continue;
      }
      payloads.push({
        kind: 'source-projection',
        path: e.path,
        columns: e.columns as string[],
      });
    } else {
      payloads.push({
        kind: kind as 'result' | 'dispersion-bins' | 'settings',
        path: e.path,
      });
    }
  }

  if (!payloads.some((p) => p.kind === 'result')) {
    return { ok: false, error: { kind: 'missing-result-payload' } };
  }

  const manifest: SnapshotManifest = {
    schema_version: 1,
    mode: mode as SnapshotMode,
    tool: tool as SnapshotToolKey,
    tool_version: obj.tool_version as string,
    captured_at: obj.captured_at as string,
    title: obj.title as string,
    source: obj.source as SnapshotManifest['source'],
    capabilities: obj.capabilities as SnapshotCapabilities,
    preview: preview as SnapshotPreview,
    payloads,
    node_colors: nodeColors as Record<string, string>,
  };

  return { ok: true, manifest, degradations };
}

function validateSourceBlock(src: unknown): ParseError | null {
  if (typeof src !== 'object' || src === null || Array.isArray(src)) {
    return { kind: 'invalid-field-type', field: 'source', expected: 'object' };
  }
  const s = src as Record<string, unknown>;
  for (const f of ['workspace_id', 'workspace_name'] as const) {
    if (typeof s[f] !== 'string') {
      return { kind: 'invalid-field-type', field: `source.${f}`, expected: 'string' };
    }
  }
  for (const f of ['node_ids', 'node_labels'] as const) {
    if (!Array.isArray(s[f]) || !(s[f] as unknown[]).every((v) => typeof v === 'string')) {
      return { kind: 'invalid-field-type', field: `source.${f}`, expected: 'string[]' };
    }
  }
  if (typeof s.total_source_rows !== 'number' || !Number.isFinite(s.total_source_rows)) {
    return {
      kind: 'invalid-field-type',
      field: 'source.total_source_rows',
      expected: 'number',
    };
  }
  return null;
}

function validateCapabilities(caps: unknown): ParseError | null {
  if (typeof caps !== 'object' || caps === null || Array.isArray(caps)) {
    return { kind: 'invalid-field-type', field: 'capabilities', expected: 'object' };
  }
  const c = caps as Record<string, unknown>;
  const required: Array<keyof SnapshotCapabilities> = [
    'canPaginate',
    'canSortAndFilterResult',
    'canExport',
    'canFilterSourceRows',
    'canCrossJump',
  ];
  for (const f of required) {
    if (typeof c[f] !== 'boolean') {
      return {
        kind: 'invalid-field-type',
        field: `capabilities.${f}`,
        expected: 'boolean',
      };
    }
  }
  return null;
}

/** Apply build-side capability gating to a parsed manifest. Returns
 * a manifest with capabilities tightened to what the build actually
 * supports, plus the list of degradations applied. Source-projection
 * payload entries are kept (so the loader knows they exist) — the
 * capability flag, not the payload list, is what gates the UI.
 *
 * Callers typically merge these degradations with parse-time ones
 * before showing the user the consolidated notice. */
export function applyBuildCapabilityGating(
  manifest: SnapshotManifest,
  buildSupport: BuildSupport = V1_BUILD_SUPPORT,
): { gated: SnapshotManifest; degradations: ParseDegradation[] } {
  const degradations: ParseDegradation[] = [];
  const gatedCaps: SnapshotCapabilities = { ...manifest.capabilities };

  if (manifest.capabilities.canFilterSourceRows && !buildSupport.supportsSourceProjection) {
    gatedCaps.canFilterSourceRows = false;
    degradations.push({
      kind: 'source-projection-unsupported',
      message:
        'This snapshot includes shareable source rows your Wordflow build does not yet support. ' +
        'Update Wordflow to inspect the underlying corpus rows.',
    });
  }
  if (manifest.capabilities.canCrossJump && !buildSupport.supportsCrossJump) {
    gatedCaps.canCrossJump = false;
    degradations.push({ kind: 'cross-jump-unsupported' });
  }

  return {
    gated: { ...manifest, capabilities: gatedCaps },
    degradations,
  };
}

/** Emit a typed manifest to a JSON string suitable for writing into
 * the bundle. Pretty-printed for diff-friendliness inside the zip. */
export function emitManifestJson(manifest: SnapshotManifest): string {
  return JSON.stringify(manifest, null, 2);
}
