import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GREY, VIZ_TINT_FOREGROUND, toBgColor } from '@/features/views/common/vizPalette';
import { WorkspaceSelectionTabs } from '../WorkspaceSelectionTabs';

const tabs = [
  { id: 'node-1', label: 'Data Block 1', color: '#2563eb', isActive: true },
  { id: 'node-2', label: 'Data Block 2', color: null, isActive: false },
];

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

afterAll(() => {
  vi.restoreAllMocks();
});

function renderSelectionTabs() {
  const props = {
    shouldShowTabs: true,
    tabs,
    tabPosition: 1,
    totalTabs: 2,
    onTabChange: vi.fn(),
    onTabClose: vi.fn(),
    onTabReorder: vi.fn(),
  };
  render(<WorkspaceSelectionTabs {...props} />);
  return props;
}

describe('WorkspaceSelectionTabs', () => {
  it('renders the shared flat editor strip only for multiple selections', () => {
    const { rerender } = render(
      <WorkspaceSelectionTabs
        shouldShowTabs={false}
        tabs={tabs}
        tabPosition={1}
        totalTabs={2}
        onTabChange={vi.fn()}
        onTabClose={vi.fn()}
        onTabReorder={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    rerender(
      <WorkspaceSelectionTabs
        shouldShowTabs
        tabs={tabs}
        tabPosition={1}
        totalTabs={2}
        onTabChange={vi.fn()}
        onTabClose={vi.fn()}
        onTabReorder={vi.fn()}
      />,
    );

    const tablist = screen.getByRole('tablist', { name: /selected node tabs/i });
    expect(tablist).toHaveClass('px-[8px]', 'pt-[8px]');
    expect(tablist).not.toHaveClass('border-b', 'bg-panel/30');
  });

  it('tints each tab with its Data Block colour, lighter when inactive', () => {
    renderSelectionTabs();

    const [activeTab, inactiveTab] = screen.getAllByRole('tab');
    const [activeFill, inactiveFill] = screen.getAllByTestId('editor-tab-fill');
    expect(activeTab).toHaveStyle({ color: VIZ_TINT_FOREGROUND });
    expect(inactiveTab).toHaveStyle({ color: VIZ_TINT_FOREGROUND });
    expect(activeFill?.style.getPropertyValue('--editor-tab-fill')).toBe(toBgColor('#2563eb'));
    expect(inactiveFill?.style.getPropertyValue('--editor-tab-fill')).toBe(toBgColor(GREY, 0.08));
    expect(inactiveFill?.style.getPropertyValue('--editor-tab-fill-hover')).toBe(toBgColor(GREY));
    expect(activeFill).toHaveClass('bg-(--editor-tab-fill)');
    expect(activeFill).not.toHaveClass('bg-editor-tab-active-background');
  });

  it('wires activate, close, and reorder intents to the selection owner', () => {
    const { onTabChange, onTabClose, onTabReorder } = renderSelectionTabs();
    const [first, second] = screen.getAllByRole('tab');

    fireEvent.pointerDown(second!, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerUp(second!, { pointerId: 1, clientX: 50 });
    fireEvent.click(screen.getAllByRole('button', { name: /close tab/i })[0]!);
    fireEvent.pointerDown(first!, { button: 0, pointerId: 2, clientX: 0 });
    fireEvent.pointerMove(first!, { pointerId: 2, clientX: 50 });
    fireEvent.pointerUp(first!, { pointerId: 2, clientX: 50 });

    expect(onTabChange).toHaveBeenCalledWith('node-2');
    expect(onTabClose).toHaveBeenCalledWith('node-1');
    expect(onTabReorder).toHaveBeenCalledWith(['node-2', 'node-1']);
  });
});
