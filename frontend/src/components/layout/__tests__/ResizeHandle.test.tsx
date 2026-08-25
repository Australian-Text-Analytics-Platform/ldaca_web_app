import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResizeHandle } from '../ResizeHandle';

describe('ResizeHandle', () => {
  it('renders the vertical grip and preserves separator interaction props', () => {
    const onPointerDown = vi.fn();
    render(
      <ResizeHandle
        orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        onPointerDown={onPointerDown}
      />,
    );

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('data-dragging', 'false');
    expect(handle).toHaveClass('cursor-col-resize');
    expect(screen.getByTestId('resize-handle-grip')).toHaveClass(
      'shadow-[0_-4px_currentColor,0_4px_currentColor]',
      'group-hover/resize-handle:delay-300',
      'duration-100',
    );

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
    expect(onPointerDown).toHaveBeenCalledOnce();
  });

  it('switches a horizontal handle from its grip to the active full-boundary highlight', () => {
    render(<ResizeHandle orientation="horizontal" isDragging aria-label="Resize sections" />);

    const handle = screen.getByRole('separator', { name: 'Resize sections' });
    const highlight = screen.getByTestId('resize-handle-highlight');
    const grip = screen.getByTestId('resize-handle-grip');

    expect(handle).toHaveAttribute('data-dragging', 'true');
    expect(handle).toHaveClass('cursor-row-resize');
    expect(highlight).toHaveClass('opacity-100', 'delay-0');
    expect(grip).toHaveClass('opacity-0', 'delay-0');
    expect(grip).toHaveClass('shadow-[-4px_0_currentColor,4px_0_currentColor]');
  });

  it('renders the VS Code-style line variant without a three-dot grip', () => {
    render(<ResizeHandle orientation="horizontal" variant="line" aria-label="Resize sections" />);

    const handle = screen.getByRole('separator', { name: 'Resize sections' });
    const highlight = screen.getByTestId('resize-handle-highlight');

    expect(handle).toHaveAttribute('data-variant', 'line');
    expect(highlight).toHaveClass(
      'opacity-0',
      'group-hover/resize-handle:opacity-100',
      'group-hover/resize-handle:delay-300',
      'duration-100',
    );
    expect(screen.queryByTestId('resize-handle-grip')).not.toBeInTheDocument();
  });

  it('removes the grip and interaction affordance when disabled', () => {
    render(
      <ResizeHandle orientation="horizontal" disabled tabIndex={0} aria-label="Resize cards" />,
    );

    const handle = screen.getByRole('separator', { name: 'Resize cards' });
    expect(handle).toHaveAttribute('aria-disabled', 'true');
    expect(handle).toHaveAttribute('tabindex', '-1');
    expect(handle).toHaveClass('pointer-events-none', 'cursor-default');
    expect(screen.getByTestId('resize-handle-grip')).toHaveClass('opacity-0');
  });
});
