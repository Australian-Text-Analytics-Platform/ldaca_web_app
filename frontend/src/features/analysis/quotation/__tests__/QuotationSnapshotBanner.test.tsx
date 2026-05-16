import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_SNAPSHOT_MODE,
  useSnapshotViewStore,
  type LoadedSnapshot,
  type SnapshotManifest,
} from '@/features/snapshot-view';
import { QuotationSnapshotBanner } from '../components/QuotationSnapshotBanner';

function fakeManifest(): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'quotation',
    tool_version: 'v0.5.0',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'quotation-demo',
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'Tutorial workspace',
      node_ids: ['n1'],
      node_labels: ['Node 1'],
      total_source_rows: 100,
    },
    capabilities: {
      canPaginate: true,
      canSortAndFilterResult: true,
      canExport: true,
      canFilterSourceRows: false,
      canCrossJump: false,
    },
    preview: {
      tool: 'quotation',
      openPattern: '(quotation rules)',
      closePattern: '',
      totalHits: 17,
      displayColumns: [],
    },
    payloads: [{ kind: 'result', path: 'tables/result.json' }],
    node_colors: {},
  };
}

function loadFixtureSnapshot() {
  const manifest = fakeManifest();
  const snapshot: LoadedSnapshot = {
    manifest,
    capabilities: manifest.capabilities,
    payload: {},
    sourceProjection: null,
  };
  useSnapshotViewStore
    .getState()
    .loadSnapshot('quotation', snapshot, DEMO_SNAPSHOT_MODE);
}

describe('QuotationSnapshotBanner', () => {
  beforeEach(() => {
    act(() => {
      useSnapshotViewStore.getState().reset();
    });
  });

  afterEach(() => {
    act(() => {
      useSnapshotViewStore.getState().reset();
    });
  });

  it('renders nothing when no snapshot is loaded for quotation', () => {
    render(<QuotationSnapshotBanner />);
    expect(screen.queryByRole('button', { name: /exit snapshot view/i })).toBeNull();
  });

  it('shows the snapshot title, version, and workspace name when loaded', () => {
    act(() => {
      loadFixtureSnapshot();
    });
    render(<QuotationSnapshotBanner />);
    expect(screen.getByText(/quotation-demo/)).toBeInTheDocument();
    expect(screen.getByText(/v0\.5\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Tutorial workspace/)).toBeInTheDocument();
  });

  it('Exit click clears the snapshot and flips view mode back to live', async () => {
    act(() => {
      loadFixtureSnapshot();
    });
    const user = userEvent.setup();
    render(<QuotationSnapshotBanner />);

    await user.click(screen.getByRole('button', { name: /exit snapshot view/i }));

    const state = useSnapshotViewStore.getState();
    expect(state.snapshots.quotation).toBeNull();
    expect(state.mode.quotation).toEqual({ kind: 'live' });
  });
});
