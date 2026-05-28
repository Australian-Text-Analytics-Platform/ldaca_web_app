import type { ComponentType } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConcordanceSnapshotBanner } from '@/features/analysis/concordance/components/ConcordanceSnapshotBanner';
import { QuotationSnapshotBanner } from '@/features/analysis/quotation/components/QuotationSnapshotBanner';
import { SequentialAnalysisSnapshotBanner } from '@/features/analysis/sequential-analysis/components/SequentialAnalysisSnapshotBanner';
import { TokenFrequencySnapshotBanner } from '@/features/analysis/token-frequency/components/TokenFrequencySnapshotBanner';
import { TopicModelingSnapshotBanner } from '@/features/analysis/topic-modeling/components/TopicModelingSnapshotBanner';
import {
  DEMO_SNAPSHOT_MODE,
  useSnapshotViewStore,
  type LoadedSnapshot,
  type SnapshotCapabilities,
  type SnapshotManifest,
  type SnapshotPreview,
  type SnapshotToolKey,
} from '@/features/snapshot-view';

interface SnapshotBannerCase {
  name: string;
  Component: ComponentType;
  tool: SnapshotToolKey;
  title: string;
  version: string;
  capabilities: SnapshotCapabilities;
  preview: SnapshotPreview;
}

/** Baseline snapshot capabilities for banners whose result payloads can paginate. */
const paginatedCapabilities: SnapshotCapabilities = {
  canPaginate: true,
  canSortAndFilterResult: true,
  canExport: true,
  canFilterSourceRows: false,
  canCrossJump: false,
};

/** Capability variant used by snapshot banners that show static preview summaries. */
const nonPaginatedCapabilities: SnapshotCapabilities = {
  ...paginatedCapabilities,
  canPaginate: false,
};

/**
 * Exercises every feature-specific snapshot banner through the same store-backed
 * live/demo mode contract.
 */
const bannerCases: SnapshotBannerCase[] = [
  {
    name: 'ConcordanceSnapshotBanner',
    Component: ConcordanceSnapshotBanner,
    tool: 'concordance',
    title: 'pride-prejudice-demo',
    version: 'v0.4.4',
    capabilities: paginatedCapabilities,
    preview: {
      tool: 'concordance',
      searchTerm: 'love',
      totalHits: 42,
      materialised: true,
      displayColumns: [],
    },
  },
  {
    name: 'TokenFrequencySnapshotBanner',
    Component: TokenFrequencySnapshotBanner,
    tool: 'token_frequencies',
    title: 'token-freq-demo',
    version: 'v0.5.0',
    capabilities: nonPaginatedCapabilities,
    preview: {
      tool: 'token_frequencies',
      vocabSize: 17,
      topToken: 'the',
      topTokenCount: 42,
      tokeniserId: '(unspecified)',
    },
  },
  {
    name: 'QuotationSnapshotBanner',
    Component: QuotationSnapshotBanner,
    tool: 'quotation',
    title: 'quotation-demo',
    version: 'v0.5.0',
    capabilities: paginatedCapabilities,
    preview: {
      tool: 'quotation',
      openPattern: '(quotation rules)',
      closePattern: '',
      totalHits: 17,
      displayColumns: [],
    },
  },
  {
    name: 'SequentialAnalysisSnapshotBanner',
    Component: SequentialAnalysisSnapshotBanner,
    tool: 'sequential_analysis',
    title: 'trends-demo',
    version: 'v0.5.0',
    capabilities: nonPaginatedCapabilities,
    preview: {
      tool: 'sequential_analysis',
      seriesCount: 3,
      bucketCount: 24,
      chartType: 'line',
    },
  },
  {
    name: 'TopicModelingSnapshotBanner',
    Component: TopicModelingSnapshotBanner,
    tool: 'topic_modeling',
    title: 'topic-demo',
    version: 'v0.5.0',
    capabilities: nonPaginatedCapabilities,
    preview: {
      tool: 'topic_modeling',
      numTopics: 12,
      vocabSize: 180,
      embedder: 'bertopic',
      wordsPerTopic: 15,
    },
  },
];

/** Used by: snapshot banner variant tests when loading per-tool fixtures because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
function makeManifest(testCase: SnapshotBannerCase): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: testCase.tool,
    tool_version: testCase.version,
    captured_at: '2026-05-16T08:00:00Z',
    title: testCase.title,
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'Tutorial workspace',
      node_ids: ['n1'],
      node_labels: ['Node 1'],
      total_source_rows: 100,
    },
    capabilities: testCase.capabilities,
    preview: testCase.preview,
    payloads: [{ kind: 'result', path: 'tables/result.json' }],
    node_colors: {},
  };
}

/** Called by: snapshot banner variant tests before rendering loaded state because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
function loadFixtureSnapshot(testCase: SnapshotBannerCase) {
  const manifest = makeManifest(testCase);
  const snapshot: LoadedSnapshot = {
    manifest,
    capabilities: manifest.capabilities,
    payload: {},
    sourceProjection: null,
  };
  useSnapshotViewStore.getState().loadSnapshot(testCase.tool, snapshot, DEMO_SNAPSHOT_MODE);
}

describe.each(bannerCases)('$name', (testCase) => {
  const Banner = testCase.Component;

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

  it('renders nothing when no snapshot is loaded', () => {
    render(<Banner />);
    expect(screen.queryByRole('button', { name: /exit snapshot view/i })).toBeNull();
  });

  it('shows the snapshot title, version, and workspace name when loaded', () => {
    act(() => {
      loadFixtureSnapshot(testCase);
    });
    render(<Banner />);
    expect(screen.getByText(new RegExp(testCase.title))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(testCase.version.replaceAll('.', '\\.'))),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tutorial workspace/)).toBeInTheDocument();
  });

  it('Exit click clears the snapshot and flips view mode back to live', async () => {
    act(() => {
      loadFixtureSnapshot(testCase);
    });
    const user = userEvent.setup();
    render(<Banner />);

    await user.click(screen.getByRole('button', { name: /exit snapshot view/i }));

    const state = useSnapshotViewStore.getState();
    expect(state.snapshots[testCase.tool]).toBeNull();
    expect(state.mode[testCase.tool]).toEqual({ kind: 'live' });
  });
});
