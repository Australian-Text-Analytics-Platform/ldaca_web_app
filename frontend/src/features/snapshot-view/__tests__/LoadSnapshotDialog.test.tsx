/* eslint-disable testing-library/no-node-access -- snapshot rows are identified by their title text; scoping per-row queries with `.closest('li')` is the cleanest way to assert on row-local content (badge, buttons) without leaking selectors into production code. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from 'sonner';
import { LoadSnapshotDialog } from '../components/LoadSnapshotDialog';
import * as generatedSdk from '@/api/generated/sdk.gen';
import * as compatModule from '../compat';
import type { SnapshotListItem } from '@/api/generated/types.gen';
import type { SnapshotManifest } from '../types';

vi.mock('@/hooks/useAuth', () => ({
  /**
   * Supplies deterministic auth context for generated snapshot SDK calls.
   * Used by: test mock object in snapshot-view/LoadSnapshotDialog.
   * Why: because the mock needs the production-shaped dependency while the test isolates this feature path.
   */
  useAuth: () => ({
    /**
     * Returns stable headers so assertions are independent of real auth state.
     * Used by: test mock object in snapshot-view/LoadSnapshotDialog.
     * Why: because the mock needs the production-shaped dependency while the test isolates this feature path.
     */
    getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  }),
}));

/**
 * Builds a valid snapshot manifest fixture for load-dialog rows.
 * Used by: Vitest setup or assertions in snapshot-view/LoadSnapshotDialog.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 * Flow: defaults create a complete manifest, then overrides replace only the fields needed by each assertion.
 */
function manifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'concordance',
    tool_version: 'v0.4.4',
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
      displayColumns: [],
    },
    payloads: [{ kind: 'result', path: 'tables/result.json' }],
    node_colors: {},
    ...overrides,
  };
}

/**
 * Builds an API list item fixture around a manifest override.
 * Used by: Vitest setup or assertions in snapshot-view/LoadSnapshotDialog.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
function item(name: string, overrides: Partial<SnapshotManifest> = {}): SnapshotListItem {
  return {
    filename: `concordance-${name}.ldaca-snapshot`,
    manifest: manifest({ title: name, ...overrides }),
    size_bytes: 1024 * 50,
  };
}

/**
 * Provides QueryClient and toast context required by LoadSnapshotDialog.
 * Used by: Vitest setup or assertions in snapshot-view/LoadSnapshotDialog.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      {ui}
    </QueryClientProvider>,
  );
}

describe('LoadSnapshotDialog', () => {
  let listSpy: ReturnType<typeof vi.spyOn>;
  let deleteOneSpy: ReturnType<typeof vi.spyOn>;
  let deleteBatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(compatModule, 'getCurrentAppVersion').mockReturnValue('v0.4.4');
    listSpy = vi.spyOn(generatedSdk, 'listSnapshots');
    deleteOneSpy = vi.spyOn(generatedSdk, 'deleteSnapshot');
    deleteBatchSpy = vi.spyOn(generatedSdk, 'batchDeleteSnapshots');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each saved snapshot with title, capture date, and size', async () => {
    listSpy.mockResolvedValue({ data: {
      items: [item('alpha'), item('beta')],
    }, error: undefined });

    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    // shadcn Dialog renders into document.body via a portal, not the
    // render container — so the textContent assertion targets the
    // alpha row's metadata line directly.
    const alphaRow = screen.getByText('alpha').closest('li')!;
    // formatBytes uses base-1000 (51200 → 51 KB).
    expect(alphaRow.textContent).toContain('51 KB');
    expect(alphaRow.textContent).toContain('v0.4.4');
  });

  it('shows an empty-state message when no snapshots exist', async () => {
    listSpy.mockResolvedValue({ data: { items: [] }, error: undefined });

    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    expect(
      await screen.findByText(/no saved snapshots/i),
    ).toBeInTheDocument();
  });

  it('marks incompatible snapshots with a badge and disabled Open button', async () => {
    listSpy.mockResolvedValue({ data: {
      items: [
        item('current', { tool_version: 'v0.4.4' }),
        item('old', { tool_version: 'v0.3.5' }),
      ],
    }, error: undefined });

    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    await screen.findByText('current');
    const oldRow = screen.getByText('old').closest('li')!;
    expect(within(oldRow).getByText(/incompatible/i)).toBeInTheDocument();
    const oldOpen = within(oldRow).getByRole('button', { name: 'Open' });
    expect(oldOpen).toBeDisabled();

    const currentRow = screen.getByText('current').closest('li')!;
    expect(within(currentRow).getByRole('button', { name: 'Open' })).not.toBeDisabled();
  });

  it("adaptive batch button reads 'Delete stale' when incompatible snapshots exist", async () => {
    listSpy.mockResolvedValue({ data: {
      items: [
        item('current', { tool_version: 'v0.4.4' }),
        item('old', { tool_version: 'v0.3.5' }),
      ],
    }, error: undefined });

    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    await screen.findByText('current');
    expect(
      screen.getByRole('button', { name: /delete stale snapshots/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete all snapshots/i }),
    ).not.toBeInTheDocument();
  });

  it("adaptive batch button reads 'Delete all' when only compatible snapshots exist", async () => {
    listSpy.mockResolvedValue({ data: {
      items: [item('a'), item('b'), item('c')],
    }, error: undefined });

    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    await screen.findByText('a');
    expect(
      screen.getByRole('button', { name: /delete all snapshots/i }),
    ).toBeInTheDocument();
  });

  it('per-row delete opens confirmation, then calls deleteOne on confirm', async () => {
    listSpy.mockResolvedValue({ data: { items: [item('foo')] }, error: undefined });
    deleteOneSpy.mockResolvedValue({ data: { deleted: ['concordance-foo.ldaca-snapshot'] }, error: undefined });

    const user = userEvent.setup();
    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    await screen.findByText('foo');
    const fooRow = screen.getByText('foo').closest('li')!;
    await user.click(within(fooRow).getByLabelText(/delete foo/i));

    // Confirm dialog appears with title + version
    expect(
      await screen.findByRole('alertdialog', { name: /delete snapshot/i }),
    ).toBeInTheDocument();
    const confirmBtn = await screen.findByRole('button', { name: 'Delete' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(deleteOneSpy).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer test' },
        path: { filename: 'concordance-foo.ldaca-snapshot' },
        throwOnError: true,
      });
    });
  });

  it('batch delete (stale) calls deleteBatch with incompatible_with version', async () => {
    listSpy.mockResolvedValue({ data: {
      items: [
        item('current', { tool_version: 'v0.4.4' }),
        item('old', { tool_version: 'v0.3.5' }),
      ],
    }, error: undefined });
    deleteBatchSpy.mockResolvedValue({ data: { deleted: ['concordance-old.ldaca-snapshot'] }, error: undefined });

    const user = userEvent.setup();
    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    await screen.findByText('current');
    await user.click(
      screen.getByRole('button', { name: /delete stale snapshots/i }),
    );
    await user.click(await screen.findByRole('button', { name: /^delete stale$/i }));

    await waitFor(() => {
      expect(deleteBatchSpy).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer test' },
        query: { tool: 'concordance', incompatible_with: 'v0.4.4' },
        throwOnError: true,
      });
    });
  });

  it('batch delete (all) calls deleteBatch without incompatible_with', async () => {
    listSpy.mockResolvedValue({ data: { items: [item('a'), item('b')] }, error: undefined });
    deleteBatchSpy.mockResolvedValue({ data: {
      deleted: ['concordance-a.ldaca-snapshot', 'concordance-b.ldaca-snapshot'],
    }, error: undefined });

    const user = userEvent.setup();
    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    await screen.findByText('a');
    await user.click(
      screen.getByRole('button', { name: /delete all snapshots/i }),
    );
    await user.click(await screen.findByRole('button', { name: /^delete all$/i }));

    await waitFor(() => {
      expect(deleteBatchSpy).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer test' },
        query: { tool: 'concordance', incompatible_with: null },
        throwOnError: true,
      });
    });
  });

  it('Open click invokes onOpenSnapshot with the filename', async () => {
    listSpy.mockResolvedValue({ data: { items: [item('foo')] }, error: undefined });
    const onOpen = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    const user = userEvent.setup();
    renderWithClient(
      <LoadSnapshotDialog
        open
        onOpenChange={onOpenChange}
        tool="concordance"
        onOpenSnapshot={onOpen}
      />,
    );

    await screen.findByText('foo');
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith('concordance-foo.ldaca-snapshot'),
    );
    // Dialog closes on success
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('Open with no onOpenSnapshot handler shows a placeholder toast', async () => {
    listSpy.mockResolvedValue({ data: { items: [item('foo')] }, error: undefined });

    const user = userEvent.setup();
    renderWithClient(
      <LoadSnapshotDialog open onOpenChange={() => {}} tool="concordance" />,
    );

    await screen.findByText('foo');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // Toast appears (Sonner renders it as a status region)
    expect(
      await screen.findByText(/snapshot view coming/i),
    ).toBeInTheDocument();
  });
});
