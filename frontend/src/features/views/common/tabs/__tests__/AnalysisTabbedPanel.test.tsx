import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalysisTab } from '@/api';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AnalysisTabbedPanel } from '../AnalysisTabbedPanel';

const baseTab: AnalysisTab = {
  tab_id: 'tab-1',
  task_id: null,
  title: 'Analysis 1',
  input_sets: { source: [] },
  settings: {},
};

// ChromeTabs uses pointer capture, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

function renderPanel(
  tabs: AnalysisTab[] = [baseTab],
  overrides: Partial<React.ComponentProps<typeof AnalysisTabbedPanel>> = {},
) {
  const props = {
    tabs,
    activeTabId: tabs[0]?.tab_id ?? null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(
    <AnalysisTabbedPanel {...props}>
      <div>Analysis panel</div>
    </AnalysisTabbedPanel>,
  );
  return props;
}

describe('AnalysisTabbedPanel', () => {
  it('renders the active tab title and its panel children', () => {
    renderPanel(undefined, { multiTabEnabled: true });

    expect(screen.getByRole('tab')).toHaveTextContent('Analysis 1');
    expect(screen.getByText('Analysis panel')).toBeInTheDocument();
  });

  it('hides the tab controls when multi-tab UI is disabled', () => {
    renderPanel(undefined, { multiTabEnabled: false });

    expect(screen.queryByRole('tablist', { name: /analysis tabs/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new tab/i })).not.toBeInTheDocument();
    expect(screen.getByText('Analysis panel')).toBeInTheDocument();
  });

  it('falls back to "Untitled" for an empty tab title', () => {
    renderPanel([{ ...baseTab, title: '' }], { multiTabEnabled: true });

    expect(screen.getByRole('tab')).toHaveTextContent('Untitled');
  });

  it('lets the user close the final tab', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel(undefined, { multiTabEnabled: true });

    await user.click(screen.getByRole('button', { name: /close tab/i }));

    expect(onClose).toHaveBeenCalledWith('tab-1');
  });

  it('creates a new tab via the add button', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderPanel(undefined, { multiTabEnabled: true });

    await user.click(screen.getByRole('button', { name: /new tab/i }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('reorders tabs when one is dragged past its neighbour', () => {
    const tabs: AnalysisTab[] = [
      {
        tab_id: 'tab-1',
        task_id: null,
        title: 'Analysis 1',
        input_sets: { source: [] },
        settings: {},
      },
      {
        tab_id: 'tab-2',
        task_id: null,
        title: 'Analysis 2',
        input_sets: { source: [] },
        settings: {},
      },
    ];
    const { onReorder } = renderPanel(tabs, { multiTabEnabled: true });
    const first = screen.getAllByRole('tab')[0]!;

    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(first, { pointerId: 1, clientX: 60 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 60 });

    expect(onReorder).toHaveBeenCalledWith(['tab-2', 'tab-1']);
  });
});
