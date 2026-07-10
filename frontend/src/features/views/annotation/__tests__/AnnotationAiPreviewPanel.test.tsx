import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnotationAiPreviewPanel } from '../components/AnnotationAiPreviewPanel';

// Hoisted spies for the data + AI backend calls so the factories can reference
// them. All LLM traffic now runs server-side under /annotation/ai/*, so the
// panel only calls our generated SDK — there is no browser SDK left to stub.
const mocks = vi.hoisted(() => ({
  getNodeDataByWorkspaceId: vi.fn(),
  getAnnotationClassDescriptions: vi.fn(),
  annotateAiPreview: vi.fn(),
  annotateAiPreviewState: vi.fn(),
  annotateAiPreviewOverride: vi.fn(),
  annotateAiAll: vi.fn(),
  detachAiPreviewedRows: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/api', () => ({
  getNodeDataByWorkspaceId: mocks.getNodeDataByWorkspaceId,
  getAnnotationClassDescriptions: mocks.getAnnotationClassDescriptions,
  annotateAiPreview: mocks.annotateAiPreview,
  annotateAiPreviewState: mocks.annotateAiPreviewState,
  annotateAiPreviewOverride: mocks.annotateAiPreviewOverride,
  annotateAiAll: mocks.annotateAiAll,
  detachAiPreviewedRows: mocks.detachAiPreviewedRows,
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

/** Wrap the panel in a fresh QueryClient (retries off) with the standard props. */
const renderPanel = (props?: { annotationColumn?: string }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnnotationAiPreviewPanel
        workspaceId="ws-1"
        nodeId="node-1"
        textColumn="text"
        annotationColumn={props?.annotationColumn ?? 'label'}
        classNodeId="class-node"
        classColumn="class"
        descriptionColumn="description"
        providerId="openrouter"
        baseUrl={null}
        apiKey="sk-test"
        model="gpt-4o"
        systemPrompt="Classify."
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select relies on pointer-capture + scrollIntoView, which jsdom lacks.
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();

  mocks.getNodeDataByWorkspaceId.mockResolvedValue({
    data: {
      data: [{ text: 'I love it' }, { text: 'I hate it' }],
      pagination: { total_rows: 2 },
    },
  });
  mocks.getAnnotationClassDescriptions.mockResolvedValue({
    data: {
      rows: [
        { class: 'Positive', description: 'good' },
        { class: 'Negative', description: 'bad' },
      ],
    },
  });
  mocks.annotateAiAll.mockResolvedValue({
    data: { node: { id: 'node-1' }, labeled_rows: 2, total_rows: 2 },
  });
  mocks.detachAiPreviewedRows.mockResolvedValue({
    data: { node: { id: 'child-1' }, detached_rows: 2 },
  });
  // Default hydration: no prior server session, so the panel starts empty and
  // relies on the per-page annotate query to populate predictions.
  mocks.annotateAiPreviewState.mockResolvedValue({ data: { rows: [] } });
  mocks.annotateAiPreviewOverride.mockResolvedValue({ data: { ok: true } });
});

describe('AnnotationAiPreviewPanel', () => {
  it('renders the page texts with backend predictions seeded into the dropdowns', async () => {
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });

    renderPanel();

    expect(await screen.findByText('I love it')).toBeInTheDocument();
    expect(screen.getByText('I hate it')).toBeInTheDocument();

    const rowOne = await screen.findByRole('combobox', { name: 'AI class for row 1' });
    const rowTwo = screen.getByRole('combobox', { name: 'AI class for row 2' });
    expect(rowOne).toHaveTextContent('Positive');
    expect(rowTwo).toHaveTextContent('Negative');

    // One backend request for the whole page, carrying the node + provider config
    // (the backend re-slices the page and owns the class list, so no texts here).
    expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(1);
    const args = mocks.annotateAiPreview.mock.calls[0]?.[0] as {
      body: Record<string, unknown>;
    };
    expect(args.body).toEqual(
      expect.objectContaining({
        node_id: 'node-1',
        text_column: 'text',
        class_node_id: 'class-node',
        provider_id: 'openrouter',
        base_url: null,
        api_key: 'sk-test',
        model: 'gpt-4o',
        instruction: 'Classify.',
        page: 1,
        page_size: 20,
      }),
    );
  });

  it('lets the user override a prediction locally without re-requesting', async () => {
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });
    const user = userEvent.setup();

    renderPanel();

    const rowOne = await screen.findByRole('combobox', { name: 'AI class for row 1' });
    // Wait for the prediction to seed the dropdown before overriding it.
    await within(rowOne).findByText('Positive');

    await user.click(rowOne);
    await user.click(await screen.findByRole('option', { name: 'None' }));

    expect(rowOne).not.toHaveTextContent('Positive');
    // Editing the dropdown is frontend-only — no extra annotate request fires.
    expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(1);
  });

  it('surfaces the AI error with a Retry that re-issues the request', async () => {
    mocks.annotateAiPreview.mockRejectedValueOnce(new Error('401 Incorrect API key'));
    const user = userEvent.setup();

    renderPanel();

    expect(await screen.findByText('401 Incorrect API key')).toBeInTheDocument();

    mocks.annotateAiPreview.mockResolvedValueOnce({ data: { labels: ['Positive', 'Negative'] } });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    const rowOne = await screen.findByRole('combobox', { name: 'AI class for row 1' });
    expect(rowOne).toHaveTextContent('Positive');
    expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(2);
  });

  it('shows an empty-state message when the source page has no rows', async () => {
    mocks.getNodeDataByWorkspaceId.mockResolvedValue({
      data: { data: [], pagination: { total_rows: 0 } },
    });

    renderPanel();

    expect(await screen.findByText('No rows to annotate.')).toBeInTheDocument();
    expect(mocks.annotateAiPreview).not.toHaveBeenCalled();
  });

  it('strikes through an existing label beside the AI prediction, but not for empty cells', async () => {
    // First row already carries a stored label; second row is blank.
    mocks.getNodeDataByWorkspaceId.mockResolvedValue({
      data: {
        data: [
          { text: 'I love it', label: 'Negative' },
          { text: 'I hate it', label: '' },
        ],
        pagination: { total_rows: 2 },
      },
    });
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });

    renderPanel({ annotationColumn: 'label' });

    // Wait for the prediction to seed the first dropdown before asserting.
    const rowOne = await screen.findByRole('combobox', { name: 'AI class for row 1' });
    await within(rowOne).findByText('Positive');

    // Existing value is rendered struck through next to the AI dropdown.
    const existing = screen.getByTitle('Existing annotation');
    expect(existing).toHaveTextContent('Negative');
    expect(existing).toHaveClass('line-through');

    // The blank second row shows no struck-through original — only one exists.
    expect(screen.getAllByTitle('Existing annotation')).toHaveLength(1);
  });

  it('runs Annotate All against the backend and toasts the labelled count', async () => {
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });
    const user = userEvent.setup();

    renderPanel();

    const annotateAll = await screen.findByRole('button', { name: 'Annotate All' });
    await user.click(annotateAll);

    expect(mocks.annotateAiAll).toHaveBeenCalledTimes(1);
    const args = mocks.annotateAiAll.mock.calls[0]?.[0] as {
      body: Record<string, unknown>;
      path: Record<string, unknown>;
    };
    expect(args.path).toEqual({ workspace_id: 'ws-1', node_id: 'node-1' });
    expect(args.body).toEqual(
      expect.objectContaining({
        text_column: 'text',
        annotation_column: 'label',
        provider_id: 'openrouter',
        model: 'gpt-4o',
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Annotated 2 of 2 rows');
  });

  it('detaches the previewed rows into a child node via a confirmation dialog', async () => {
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });
    const user = userEvent.setup();

    renderPanel();

    // The dry-run probe reports 2 rows in the server session, so Detach enables.
    const detach = await screen.findByRole('button', { name: 'Detach Previewed Rows' });
    await waitFor(() => {
      expect(detach).toBeEnabled();
    });
    await user.click(detach);

    // Clicking opens a confirmation dialog that names how many rows will detach.
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/2 previewed rows/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Detach' }));

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Detached 2 previewed rows');
    });
    // The real detach call (not a dry-run probe) carries only the node + column —
    // the server owns the previewed-row set, so no per-row labels are shipped.
    const realCall = mocks.detachAiPreviewedRows.mock.calls
      .map((call) => call[0] as { body: Record<string, unknown>; path: Record<string, unknown> })
      .find((arg) => arg.body.dry_run !== true);
    expect(realCall?.path).toEqual({ workspace_id: 'ws-1', node_id: 'node-1' });
    expect(realCall?.body).toEqual({ annotation_column: 'label' });
  });

  it('keeps Detach disabled when the server probe reports no previewed rows', async () => {
    // Simulates returning to the tab with a cleared/empty session: the dry-run probe
    // reports 0, so the button stays disabled even though the panel just remounted
    // (the local page map is gone, but the server session is the source of truth).
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });
    mocks.detachAiPreviewedRows.mockResolvedValue({ data: { node: null, detached_rows: 0 } });

    renderPanel();

    const detach = await screen.findByRole('button', { name: 'Detach Previewed Rows' });
    await waitFor(() => {
      // The probe fired with dry_run:true …
      expect(
        mocks.detachAiPreviewedRows.mock.calls.some(
          (call) => (call[0] as { body: Record<string, unknown> }).body.dry_run === true,
        ),
      ).toBe(true);
    });
    // … and reported 0, so Detach never enables.
    expect(detach).toBeDisabled();
  });

  it('persists a local override to the backend preview session', async () => {
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });
    const user = userEvent.setup();

    renderPanel();

    // Override row 2's prediction: the edit is written to the server session so it
    // survives a tab switch and is honoured by detach/annotate-all.
    const rowTwo = await screen.findByRole('combobox', { name: 'AI class for row 2' });
    await within(rowTwo).findByText('Negative');
    await user.click(rowTwo);
    await user.click(await screen.findByRole('option', { name: 'Positive' }));

    await waitFor(() => {
      expect(mocks.annotateAiPreviewOverride).toHaveBeenCalledTimes(1);
    });
    const args = mocks.annotateAiPreviewOverride.mock.calls[0]?.[0] as {
      body: Record<string, unknown>;
      path: Record<string, unknown>;
    };
    expect(args.path).toEqual({ workspace_id: 'ws-1', node_id: 'node-1', row_index: 1 });
    expect(args.body).toEqual({ label: 'Positive' });
  });

  it('sends a null override when the user clears a cell to None', async () => {
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });
    const user = userEvent.setup();

    renderPanel();

    const rowOne = await screen.findByRole('combobox', { name: 'AI class for row 1' });
    await within(rowOne).findByText('Positive');
    await user.click(rowOne);
    await user.click(await screen.findByRole('option', { name: 'None' }));

    await waitFor(() => {
      expect(mocks.annotateAiPreviewOverride).toHaveBeenCalledTimes(1);
    });
    const args = mocks.annotateAiPreviewOverride.mock.calls[0]?.[0] as {
      body: Record<string, unknown>;
      path: Record<string, unknown>;
    };
    // The "None" pick is an explicit null override (still beats the model label).
    expect(args.path).toEqual({ workspace_id: 'ws-1', node_id: 'node-1', row_index: 0 });
    expect(args.body).toEqual({ label: null });
  });

  it('rehydrates AI labels and overrides from the server session on mount', async () => {
    // The per-page annotate query would return these too, but delay it so the
    // assertion clearly reflects the hydration payload seeding the dropdowns.
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['Positive', 'Negative'] } });
    mocks.annotateAiPreviewState.mockResolvedValue({
      data: {
        rows: [
          { row_index: 0, ai: 'Positive', override: null, has_override: false, effective: 'Positive' },
          // Row 1 was AI-labelled "Positive" but the user overrode it to "Negative".
          { row_index: 1, ai: 'Positive', override: 'Negative', has_override: true, effective: 'Negative' },
        ],
      },
    });

    renderPanel();

    const rowTwo = await screen.findByRole('combobox', { name: 'AI class for row 2' });
    // The restored override (Negative) wins over the model's "Positive".
    await within(rowTwo).findByText('Negative');
    // The dry-run probe reports a non-empty session, so Detach is enabled.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Detach Previewed Rows' })).toBeEnabled();
    });
    expect(mocks.annotateAiPreviewState).toHaveBeenCalledTimes(1);
  });
});
