import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type EditorTabItem, EditorTabs } from '../EditorTabs';

const tabs: EditorTabItem[] = [
  { id: 'tab-1', title: 'Analysis 1' },
  { id: 'tab-2', title: 'Analysis 2' },
  { id: 'tab-3', title: 'Analysis 3' },
];

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

afterAll(() => {
  vi.restoreAllMocks();
});

function renderTabs(overrides: Partial<React.ComponentProps<typeof EditorTabs>> = {}) {
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
  render(<EditorTabs {...props} />);
  return props;
}

describe('EditorTabs', () => {
  it('uses modern editor-tab hit targets and inset fills', () => {
    renderTabs();

    const [activeTab] = screen.getAllByRole('tab');
    const [activeFill, inactiveFill] = screen.getAllByTestId('editor-tab-fill');
    expect(activeTab).toHaveAttribute('data-editor-tab');
    expect(activeTab).toHaveClass('h-[32px]');
    expect(screen.getByRole('tablist')).toHaveClass('px-[8px]', 'pt-[8px]');
    expect(activeFill).toHaveClass(
      'inset-x-[2px]',
      'inset-y-[4px]',
      'rounded-[4px]',
      'bg-editor-tab-active-background',
    );
    expect(inactiveFill).toHaveClass(
      'bg-transparent',
      'group-hover:bg-editor-tab-hover-background',
    );
  });

  it('allows horizontal overflow without showing a vertical scrollbar', () => {
    renderTabs();

    expect(screen.getByRole('tablist')).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
  });

  it('activates an inactive tab on a click without drag travel', () => {
    const { onActivate } = renderTabs();
    const second = screen.getAllByRole('tab')[1]!;

    fireEvent.pointerDown(second, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerUp(second, { pointerId: 1, clientX: 50 });

    expect(onActivate).toHaveBeenCalledWith('tab-2');
  });

  it('moves focus and activation with editor-tab keyboard navigation', async () => {
    const user = userEvent.setup();
    const { onActivate } = renderTabs({ onRename: undefined });
    const [first, second, third] = screen.getAllByRole('tab');

    first!.focus();
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    expect(onActivate).toHaveBeenLastCalledWith('tab-2');

    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    expect(onActivate).toHaveBeenLastCalledWith('tab-3');

    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    expect(onActivate).toHaveBeenLastCalledWith('tab-1');
  });

  it('renders optional icons and panel relationships', () => {
    renderTabs({
      tabs: [
        {
          id: 'tab-1',
          title: 'Filter',
          icon: <svg data-testid="filter-icon" />,
          tabDomId: 'filter-tab',
          panelDomId: 'filter-panel',
          'data-guidance': 'preprocessing-operation-filter',
        },
      ],
      activeTabId: 'tab-1',
    });

    const tab = screen.getByRole('tab', { name: 'Filter' });
    expect(tab).toHaveAttribute('id', 'filter-tab');
    expect(tab).toHaveAttribute('aria-controls', 'filter-panel');
    expect(tab).toHaveAttribute('data-guidance', 'preprocessing-operation-filter');
    expect(within(tab).getByTestId('filter-icon')).toBeInTheDocument();
  });

  it('shows every tab full name in a delayed custom hover bubble', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.hover(screen.getByRole('tab', { name: 'Analysis 1' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Analysis 1');
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

  it('keeps the active close action visible and reveals inactive actions on interaction', () => {
    renderTabs();

    const [activeClose, inactiveClose] = screen.getAllByRole('button', { name: /close tab/i });
    expect(activeClose).toHaveClass('opacity-100');
    expect(activeClose).toHaveClass('size-[24px]');
    const [activeHighlight] = screen.getAllByTestId('close-tab-highlight');
    expect(activeHighlight).toHaveClass(
      'inset-[2px]',
      'rounded-[3px]',
      'group-hover/close:bg-foreground/10',
      'group-focus-visible/close:bg-foreground/10',
    );
    expect(inactiveClose).toHaveClass('opacity-0', 'group-hover:opacity-100');
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

    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(first, { pointerId: 1, clientX: 50 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50 });

    expect(onReorder).toHaveBeenCalledWith(['tab-2', 'tab-1', 'tab-3']);
  });

  it('fades an overflowing title tail instead of showing an ellipsis', async () => {
    renderTabs({ tabs: [{ id: 'tab-1', title: 'A very long analysis tab title' }] });

    const title = within(screen.getByTestId('editor-tab-title')).getByText(
      'A very long analysis tab title',
    );
    const titleMeasure = screen.getByTestId('editor-tab-title-measure');
    Object.defineProperty(titleMeasure, 'offsetWidth', { configurable: true, value: 400 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(title).toHaveStyle({
        maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent)',
      });
    });
    expect(title).not.toHaveClass('truncate');
    expect(title).toHaveClass('overflow-hidden', '[text-overflow:clip]');
  });

  it('sizes tabs from their intrinsic title width up to the maximum', async () => {
    renderTabs({
      tabs: [
        { id: 'tab-1', title: 'A' },
        { id: 'tab-2', title: 'Long title' },
      ],
      activeTabId: 'tab-1',
    });

    const tablist = screen.getByRole('tablist');
    const [shortMeasure, longMeasure] = screen.getAllByTestId('editor-tab-title-measure');
    Object.defineProperty(tablist, 'clientWidth', { configurable: true, value: 500 });
    Object.defineProperty(shortMeasure!, 'offsetWidth', { configurable: true, value: 8 });
    Object.defineProperty(longMeasure!, 'offsetWidth', { configurable: true, value: 80 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      const [shortTab, longTab] = screen.getAllByRole('tab');
      expect(shortTab).toHaveStyle({ width: '52px' });
      expect(longTab).toHaveStyle({ width: '124px' });
    });
  });

  it('omits create, close, and reorder affordances when their callbacks are absent', () => {
    render(<EditorTabs tabs={tabs} activeTabId="tab-1" onActivate={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /new tab/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /close tab/i })).toBeNull();
  });
});
