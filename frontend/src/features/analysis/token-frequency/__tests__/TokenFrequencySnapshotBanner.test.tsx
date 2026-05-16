import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_SNAPSHOT_MODE,
  useSnapshotViewStore,
  type LoadedSnapshot,
  type SnapshotManifest,
} from '@/features/snapshot-view';
import { TokenFrequencySnapshotBanner } from '../components/TokenFrequencySnapshotBanner';

function fakeManifest(): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'token_frequencies',
    tool_version: 'v0.5.0',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'token-freq-demo',
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'Tutorial workspace',
      node_ids: ['n1'],
      node_labels: ['Node 1'],
      total_source_rows: 100,
    },
    capabilities: {
      canPaginate: false,
      canSortAndFilterResult: true,
      canExport: true,
      canFilterSourceRows: false,
      canCrossJump: false,
    },
    preview: {
      tool: 'token_frequencies',
      vocabSize: 17,
      topToken: 'the',
      topTokenCount: 42,
      tokeniserId: '(default)',
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
    .loadSnapshot('token_frequencies', snapshot, DEMO_SNAPSHOT_MODE);
}

describe('TokenFrequencySnapshotBanner', () => {
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

  it('renders nothing when no snapshot is loaded for token-frequency', () => {
    render(<TokenFrequencySnapshotBanner />);
    expect(screen.queryByRole('button', { name: /exit snapshot view/i })).toBeNull();
  });

  it('shows the snapshot title, version, and workspace name when loaded', () => {
    act(() => {
      loadFixtureSnapshot();
    });
    render(<TokenFrequencySnapshotBanner />);
    expect(screen.getByText(/token-freq-demo/)).toBeInTheDocument();
    expect(screen.getByText(/v0\.5\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Tutorial workspace/)).toBeInTheDocument();
  });

  it('Exit click clears the snapshot and flips view mode back to live', async () => {
    act(() => {
      loadFixtureSnapshot();
    });
    const user = userEvent.setup();
    render(<TokenFrequencySnapshotBanner />);

    await user.click(screen.getByRole('button', { name: /exit snapshot view/i }));

    const state = useSnapshotViewStore.getState();
    expect(state.snapshots.token_frequencies).toBeNull();
    expect(state.mode.token_frequencies).toEqual({ kind: 'live' });
  });
});
