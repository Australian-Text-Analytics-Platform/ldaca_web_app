import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SidebarTasksSection from '../SidebarTasksSection';
import type { TaskItem } from '@/features/workspace/task-stream/taskProjection';

/** Default connection props shared by task-section tests. */
const baseProps = {
  isConnected: true,
  isConnecting: false,
  connectionError: null,
  onReconnect: vi.fn(),
  onStopUserFileImport: vi.fn(),
  onClearUserFileImport: vi.fn(),
  onClearUnavailableAnalysis: vi.fn(),
  stoppingImportId: null,
  clearingImportId: null,
  clearingAnalysisTabId: null,
};

/** Called by: SidebarTasksSection tests that need compact task fixture rendering. */
const renderTasks = (tasks: TaskItem[]) =>
  render(<SidebarTasksSection {...baseProps} tasks={tasks} />);

describe('SidebarTasksSection', () => {
  it('keeps successful tasks visible until the user clears them', () => {
    vi.useFakeTimers();

    render(
      <SidebarTasksSection
        {...baseProps}
        tasks={[
          {
            resource_type: 'analysis',
            task_id: 'task-success',
            task_type: 'token_frequencies',
            workspace_id: 'workspace-1',
            tab_id: 'tab-1',
            state: 'successful',
            progress: 1,
            finished_at: '2026-01-01T00:00:00Z',
          },
        ]}
      />,
    );

    vi.advanceTimersByTime(10_000);

    expect(screen.getByText(/token frequencies/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('pins problematic tasks above running and successful tasks', () => {
    renderTasks([
      {
        resource_type: 'analysis',
        task_id: 'task-success',
        task_type: 'topic_modeling',
        workspace_id: 'workspace-1',
        tab_id: 'tab-1',
        state: 'successful',
        finished_at: '2026-01-03T00:00:00Z',
      },
      {
        resource_type: 'analysis',
        task_id: 'task-running',
        task_type: 'token_frequencies',
        workspace_id: 'workspace-1',
        tab_id: 'tab-1',
        state: 'running',
        started_at: '2026-01-02T00:00:00Z',
      },
      {
        resource_type: 'analysis',
        task_id: 'task-failed',
        task_type: 'concordance',
        workspace_id: 'workspace-1',
        tab_id: 'tab-1',
        state: 'failed',
        finished_at: '2026-01-01T00:00:00Z',
      },
    ]);

    const cards = screen.getAllByRole('button', { name: /task:/i });
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('concordance'),
      expect.stringContaining('token frequencies'),
      expect.stringContaining('topic modeling'),
    ]);
  });

  it('shows the failure without stale progress after a task becomes terminal', async () => {
    const user = userEvent.setup();

    renderTasks([
      {
        resource_type: 'analysis',
        task_id: 'task-failed',
        task_type: 'topic_modeling',
        workspace_id: 'workspace-1',
        tab_id: 'tab-1',
        state: 'failed',
        message: 'Save failed',
        progress_message: 'Queued',
        created_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-02T00:00:00Z',
      },
    ]);

    await user.click(screen.getByRole('button', { name: /task: topic modeling/i }));

    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/^queued$/i)).not.toBeInTheDocument();
  });

  it('shows live progress details while a task is active', async () => {
    const user = userEvent.setup();

    renderTasks([
      {
        resource_type: 'analysis',
        task_id: 'task-running',
        task_type: 'token_frequencies',
        workspace_id: 'workspace-1',
        tab_id: 'tab-1',
        state: 'running',
        message: 'Running',
        progress_message: 'Tokenizing documents',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);

    await user.click(screen.getByRole('button', { name: /task: token frequencies/i }));

    expect(screen.getByText(/tokenizing documents/i)).toBeInTheDocument();
  });

  it('keeps available Analysis rows actionless because lifecycle belongs to their Tabs', async () => {
    const user = userEvent.setup();

    renderTasks([
      {
        resource_type: 'analysis',
        task_id: 'task-running',
        task_type: 'topic_modeling',
        workspace_id: 'workspace-1',
        tab_id: 'tab-1',
        state: 'running',
        progress: 0.4,
        created_at: '2026-01-02T00:00:00Z',
      },
      {
        resource_type: 'analysis',
        task_id: 'task-success',
        task_type: 'token_frequencies',
        workspace_id: 'workspace-1',
        tab_id: 'tab-1',
        state: 'successful',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);

    await user.click(screen.getByRole('button', { name: /task: topic modeling/i }));
    await user.click(screen.getByRole('button', { name: /task: token frequencies/i }));

    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument();
  });

  it('offers Clear results for an unavailable Analysis', async () => {
    const user = userEvent.setup();
    const onClearUnavailableAnalysis = vi.fn();

    render(
      <SidebarTasksSection
        {...baseProps}
        onClearUnavailableAnalysis={onClearUnavailableAnalysis}
        tasks={[
          {
            resource_type: 'analysis',
            task_id: 'analysis-unavailable',
            task_type: 'analysis_unavailable',
            workspace_id: 'workspace-1',
            tab_id: 'tab-1',
            state: 'failed',
            message: 'This Analysis is unavailable.',
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /task: analysis unavailable/i }));
    await user.click(screen.getByRole('button', { name: /clear results/i }));

    expect(onClearUnavailableAnalysis).toHaveBeenCalledWith('workspace-1', 'tab-1');
  });

  it('shows Stop only for active User File Imports and invokes the import action', async () => {
    const user = userEvent.setup();
    const onStopUserFileImport = vi.fn();

    render(
      <SidebarTasksSection
        {...baseProps}
        onStopUserFileImport={onStopUserFileImport}
        tasks={[
          {
            resource_type: 'user_file_import',
            task_id: 'import-running',
            task_type: 'sample_import',
            state: 'running',
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /task: sample import/i }));
    await user.click(screen.getByRole('button', { name: /^stop$/i }));

    expect(onStopUserFileImport).toHaveBeenCalledWith('import-running');
    expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument();
  });

  it('shows Clear only for terminal User File Imports and disables it while pending', async () => {
    const user = userEvent.setup();
    const onClearUserFileImport = vi.fn();

    render(
      <SidebarTasksSection
        {...baseProps}
        onClearUserFileImport={onClearUserFileImport}
        clearingImportId="import-failed"
        tasks={[
          {
            resource_type: 'user_file_import',
            task_id: 'import-failed',
            task_type: 'data_portal_import',
            state: 'failed',
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /task: data portal import/i }));

    expect(screen.getByRole('button', { name: /clearing/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(onClearUserFileImport).not.toHaveBeenCalled();
  });
});
