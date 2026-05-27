import { act } from '@testing-library/react';
import JSZip from 'jszip';
import { vi } from 'vitest';

import * as generatedSdk from '@/api/generated/sdk.gen';
import {
  useSnapshotViewStore,
  type SnapshotManifest,
  type SnapshotPayloadEntry,
  type SnapshotPreview,
  type SnapshotToolKey,
} from '@/features/snapshot-view';

interface ManifestInput {
  tool: SnapshotToolKey;
  preview: SnapshotPreview;
  payloads: SnapshotPayloadEntry[];
  version?: string;
  canPaginate?: boolean;
}

export function makeSnapshotManifest(
  input: ManifestInput,
  overrides: Partial<SnapshotManifest> = {},
): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: input.tool,
    tool_version: input.version ?? 'v0.5.0',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'fixture',
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'WS',
      node_ids: ['n1'],
      node_labels: ['Node 1'],
      total_source_rows: 100,
    },
    capabilities: {
      canPaginate: input.canPaginate ?? false,
      canSortAndFilterResult: true,
      canExport: true,
      canFilterSourceRows: false,
      canCrossJump: false,
    },
    preview: input.preview,
    payloads: input.payloads,
    node_colors: { n1: '#aabbcc' },
    ...overrides,
  };
}

export async function buildJsonBundleBlob(
  manifest: SnapshotManifest,
  files: Record<string, unknown>,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  for (const [filePath, payload] of Object.entries(files)) {
    zip.file(filePath, JSON.stringify(payload));
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}

export function mockSnapshotDownload() {
  const spy = vi.spyOn(generatedSdk, 'downloadSnapshot');
  const mockResolvedValue = spy.mockResolvedValue.bind(spy);
  spy.mockResolvedValue = ((value: Blob) =>
    mockResolvedValue({ data: value, error: undefined })) as unknown as typeof spy.mockResolvedValue;
  return spy;
}

export function resetSnapshotStore() {
  act(() => {
    useSnapshotViewStore.getState().reset();
  });
}
