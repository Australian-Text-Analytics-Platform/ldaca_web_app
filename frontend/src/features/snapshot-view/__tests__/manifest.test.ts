import { describe, expect, it } from 'vitest';
import {
  V1_BUILD_SUPPORT,
  applyBuildCapabilityGating,
  emitManifestJson,
  parseManifest,
  parseManifestJson,
} from '../manifest';
import type { SnapshotManifest } from '../types';

/**
 * Builds a valid demo manifest fixture with optional overrides.
 * Used by: Vitest setup or assertions in snapshot-view/manifest.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 * Flow: defaults define every required manifest block, then tests mutate one block to exercise validation.
 */
function demoManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'concordance',
    tool_version: 'v0.4.4',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'a teaching example',
    source: {
      workspace_id: 'ws-abc',
      workspace_name: 'Tutorial workspace',
      node_ids: ['n1', 'n2'],
      node_labels: ['Brontë', 'Austen'],
      total_source_rows: 1842,
    },
    capabilities: {
      canPaginate: true,
      canSortAndFilterResult: true,
      canExport: true,
      canFilterSourceRows: false,
      canCrossJump: false,
    },
    preview: {
      tool: 'concordance',
      searchTerm: 'love',
      totalHits: 42,
      materialised: true,
      displayColumns: ['doc_id', 'matched_text'],
    },
    payloads: [
      { kind: 'result', path: 'tables/result.parquet' },
      { kind: 'dispersion-bins', path: 'tables/dispersion-bins.json' },
    ],
    node_colors: { n1: '#aabbcc', n2: '#ddee00' },
    ...overrides,
  };
}

/**
 * Builds a share-mode manifest fixture for capability-gating tests.
 * Used by: Vitest setup or assertions in snapshot-view/manifest.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
function shareManifest(): SnapshotManifest {
  return demoManifest({
    mode: 'share',
    capabilities: {
      canPaginate: true,
      canSortAndFilterResult: true,
      canExport: true,
      canFilterSourceRows: true,
      canCrossJump: false,
    },
    payloads: [
      { kind: 'result', path: 'tables/result.parquet' },
      { kind: 'dispersion-bins', path: 'tables/dispersion-bins.json' },
      {
        kind: 'source-projection',
        path: 'tables/source.parquet',
        columns: ['text', 'doc_id', 'tokens'],
      },
    ],
  });
}

describe('parseManifest — happy path', () => {
  it('round-trips an emitted demo manifest identically', () => {
    const m = demoManifest();
    const text = emitManifestJson(m);
    const result = parseManifestJson(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toEqual(m);
      expect(result.degradations).toEqual([]);
    }
  });

  it('parses a share manifest cleanly with no degradations (codec stage)', () => {
    const m = shareManifest();
    const result = parseManifest(m);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.mode).toBe('share');
      expect(result.degradations).toEqual([]);
    }
  });
});

describe('parseManifest — fatal errors', () => {
  it('rejects invalid JSON', () => {
    const result = parseManifestJson('{not: valid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-json');
  });

  it('rejects a non-object root', () => {
    const result = parseManifest([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not-an-object');
  });

  it('rejects an unsupported schema_version', () => {
    const result = parseManifest({ ...demoManifest(), schema_version: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'unsupported-schema-version', version: 99 });
    }
  });

  it('rejects an unknown mode', () => {
    const result = parseManifest({ ...demoManifest(), mode: 'public' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unknown-mode');
  });

  it('rejects an unknown tool', () => {
    const result = parseManifest({ ...demoManifest(), tool: 'mystery_tool' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unknown-tool');
  });

  it('rejects a manifest missing the result payload', () => {
    const m = demoManifest({
      payloads: [{ kind: 'dispersion-bins', path: 'tables/dispersion-bins.json' }],
    });
    const result = parseManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('missing-result-payload');
  });

  it('rejects a manifest with malformed capabilities', () => {
    const m = demoManifest();
    const bad = {
      ...m,
      capabilities: { ...m.capabilities, canExport: 'yes' as unknown as boolean },
    };
    const result = parseManifest(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-field-type');
  });

  it('rejects when source.total_source_rows is missing', () => {
    const m = demoManifest();
    const broken: Record<string, unknown> = { ...m, source: { ...m.source } };
    delete (broken.source as Record<string, unknown>).total_source_rows;
    const result = parseManifest(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-field-type');
  });
});

describe('parseManifest — additive forward-compat', () => {
  it('ignores an unknown payload kind with a degradation entry, keeping the rest', () => {
    const m = demoManifest();
    const raw = {
      ...m,
      payloads: [...m.payloads, { kind: 'future-supplement', path: 'tables/future.parquet' }],
    };
    const result = parseManifest(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.payloads).toEqual(m.payloads);
      expect(result.degradations).toContainEqual({
        kind: 'unknown-payload-kind',
        rawKind: 'future-supplement',
        path: 'tables/future.parquet',
      });
    }
  });

  it('treats a malformed source-projection entry as unknown', () => {
    const m = demoManifest();
    const raw = {
      ...m,
      payloads: [
        ...m.payloads,
        // missing `columns` — malformed for this kind
        { kind: 'source-projection', path: 'tables/source.parquet' },
      ],
    };
    const result = parseManifest(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.payloads.some((p) => p.kind === 'source-projection')).toBe(false);
      expect(result.degradations).toContainEqual({
        kind: 'unknown-payload-kind',
        rawKind: 'source-projection',
        path: 'tables/source.parquet',
      });
    }
  });
});

describe('applyBuildCapabilityGating — Mode 2a graceful-degrade contract', () => {
  it('v1 build gates canFilterSourceRows to false on a share manifest', () => {
    const m = shareManifest();
    const { gated, degradations } = applyBuildCapabilityGating(m, V1_BUILD_SUPPORT);

    expect(gated.capabilities.canFilterSourceRows).toBe(false);
    expect(degradations.find((d) => d.kind === 'source-projection-unsupported')).toBeDefined();
  });

  it('v1 build keeps the source-projection payload entry (for diagnostics)', () => {
    // The payload list survives gating — the capability flag is the
    // single source of truth for UI enablement. This lets a future
    // build version flip the flag and immediately use the payload
    // without re-loading the bundle.
    const m = shareManifest();
    const { gated } = applyBuildCapabilityGating(m, V1_BUILD_SUPPORT);
    expect(gated.payloads.some((p) => p.kind === 'source-projection')).toBe(true);
  });

  it('a build that supports source-projection passes capabilities through unchanged', () => {
    const futureBuild = { supportsSourceProjection: true, supportsCrossJump: true };
    const m = shareManifest();
    const { gated, degradations } = applyBuildCapabilityGating(m, futureBuild);
    expect(gated.capabilities).toEqual(m.capabilities);
    expect(degradations).toEqual([]);
  });

  it('demo manifests need no gating', () => {
    const m = demoManifest();
    const { gated, degradations } = applyBuildCapabilityGating(m);
    expect(gated.capabilities).toEqual(m.capabilities);
    expect(degradations).toEqual([]);
  });

  it('gates cross-jump capability independently of source-projection', () => {
    const m = demoManifest({
      capabilities: {
        canPaginate: true,
        canSortAndFilterResult: true,
        canExport: true,
        canFilterSourceRows: false,
        canCrossJump: true,
      },
    });
    const { gated, degradations } = applyBuildCapabilityGating(m);
    expect(gated.capabilities.canCrossJump).toBe(false);
    expect(degradations.find((d) => d.kind === 'cross-jump-unsupported')).toBeDefined();
  });
});
