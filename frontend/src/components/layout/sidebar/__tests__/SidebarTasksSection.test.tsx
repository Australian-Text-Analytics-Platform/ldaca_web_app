import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SidebarTasksSection from '../SidebarTasksSection';
import type { SidebarTaskRecord } from '../types';

/** Default connection props shared by task-section tests. */
const baseProps = {
  isConnected: true,
  isConnecting: false,
  connectionError: null,
  onReconnect: vi.fn(),
};

/** Called by: SidebarTasksSection tests that need compact task fixture rendering. */
const renderTasks = (tasks: SidebarTaskRecord[]) =>
  render(<SidebarTasksSection {...baseProps} tasks={tasks} />);

describe('SidebarTasksSection', () => {
  it('keeps successful tasks visible until the user clears them', () => {
    vi.useFakeTimers();

    render(
      <SidebarTasksSection
        {...baseProps}
        tasks={[
          {
            task_id: 'task-success',
            task_type: 'token_frequencies',
            state: 'successful',
            progress: 1,
            finished_at: 100,
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
        task_id: 'task-success',
        task_type: 'topic_modeling',
        state: 'successful',
        finished_at: 300,
      },
      {
        task_id: 'task-running',
        task_type: 'token_frequencies',
        state: 'running',
        started_at: 200,
      },
      {
        task_id: 'task-failed',
        task_type: 'concordance_materialize',
        state: 'failed',
        finished_at: 100,
      },
    ]);

    const cards = screen.getAllByRole('button', { name: /task:/i });
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('concordance materialize'),
      expect.stringContaining('token frequencies'),
      expect.stringContaining('topic modeling'),
    ]);
  });

  it('shows the failure without stale progress after a task becomes terminal', async () => {
    const user = userEvent.setup();

    renderTasks([
      {
        task_id: 'task-failed',
        task_type: 'topic_modeling',
        state: 'failed',
        message: 'Save failed',
        progress_message: 'Queued',
        created_at: 100,
        finished_at: 200,
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
        task_id: 'task-running',
        task_type: 'token_frequencies',
        state: 'running',
        message: 'Running',
        progress_message: 'Tokenizing documents',
        created_at: 100,
      },
    ]);

    await user.click(screen.getByRole('button', { name: /task: token frequencies/i }));

    expect(screen.getByText(/tokenizing documents/i)).toBeInTheDocument();
  });

  it('does not render task lifecycle action buttons in expanded details', async () => {
    const user = userEvent.setup();

    renderTasks([
      {
        task_id: 'task-running',
        task_type: 'topic_modeling',
        state: 'running',
        progress: 0.4,
        created_at: 100,
      },
      {
        task_id: 'task-success',
        task_type: 'token_frequencies',
        state: 'successful',
        created_at: 90,
      },
    ]);

    await user.click(screen.getByRole('button', { name: /task: topic modeling/i }));
    await user.click(screen.getByRole('button', { name: /task: token frequencies/i }));

    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument();
  });
});
