import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type ChromeTabItem, ChromeTabs } from '../ChromeTabs';

const tabs: ChromeTabItem[] = [
  { id: 'tab-1', title: 'Analysis 1' },
  { id: 'tab-2', title: 'Analysis 2' },
  { id: 'tab-3', title: 'Analysis 3' },
];

// jsdom does not implement pointer capture; stub it so drag handlers run.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

afterAll(() => {
  vi.restoreAllMocks();
});

function renderTabs(overrides: Partial<React.ComponentProps<typeof ChromeTabs>> = {}) {
  const props = {
    tabs,
    activeTabId: 'tab-1',
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<ChromeTabs {...props} />);
  return props;
}

describe('ChromeTabs', () => {
  it('allows horizontal overflow without showing a vertical scrollbar', () => {
    renderTabs();

    expect(screen.getByRole('tablist')).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
  });

  it('activates an inactive tab on a click without drag travel', () => {
    const { onActivate } = renderTabs();
    const second = screen.getAllByRole('tab')[1]!;

    fireEvent.pointerDown(second, { button: 0, pointerId: 1, clientX: 60 });
    fireEvent.pointerUp(second, { pointerId: 1, clientX: 60 });

    expect(onActivate).toHaveBeenCalledWith('tab-2');
  });

  it('renames the active tab when it is clicked again', async () => {
    const user = userEvent.setup();
    const { onRename } = renderTabs();
    const first = screen.getAllByRole('tab')[0]!;

    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 0 });

    const input = screen.getByRole('textbox', { name: /rename tab/i });
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');

    expect(onRename).toHaveBeenCalledWith('tab-1', 'Renamed');
  });

  it('closes a tab via its close button', () => {
    const { onClose } = renderTabs();
    const [closeFirst] = screen.getAllByRole('button', { name: /close tab/i });

    fireEvent.click(closeFirst!);

    expect(onClose).toHaveBeenCalledWith('tab-1');
  });

  it('creates a tab via the trailing add button', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderTabs();

    await user.click(screen.getByRole('button', { name: /new tab/i }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('reorders tabs when one is dragged past its neighbour', () => {
    const { onReorder } = renderTabs();
    const first = screen.getAllByRole('tab')[0]!;

    // With a 0-width container every tab is min-width (56) + gap (4) = 60px
    // apart, so dragging the first tab ~60px right lands it in slot 1.
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(first, { pointerId: 1, clientX: 60 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 60 });

    expect(onReorder).toHaveBeenCalledWith(['tab-2', 'tab-1', 'tab-3']);
  });

  it('shows the full title via a native tooltip attribute', () => {
    renderTabs({ tabs: [{ id: 'tab-1', title: 'A very long analysis tab title' }] });

    expect(screen.getByText('A very long analysis tab title')).toBeInTheDocument();
  });

  it('keeps the title fade hidden until hover/focus when the title fits', () => {
    renderTabs({ tabs: [{ id: 'tab-1', title: 'Short' }] });

    const fade = screen.getByTestId('tab-title-fade');
    expect(fade).toHaveClass('opacity-0');
    expect(fade).toHaveClass('group-hover:opacity-100');
    expect(fade).toHaveClass('group-focus-within:opacity-100');
    expect(fade).toHaveClass('bg-linear-to-l');
  });

  it('omits create, close, and reorder affordances when their callbacks are absent', () => {
    render(<ChromeTabs tabs={tabs} activeTabId="tab-1" onActivate={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /new tab/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /close tab/i })).toBeNull();
  });
});
