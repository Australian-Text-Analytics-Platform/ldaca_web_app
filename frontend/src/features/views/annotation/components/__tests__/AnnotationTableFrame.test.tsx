import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ANNOTATION_TABLE_DEFAULT_HEIGHT,
  clampAnnotationTableHeight,
} from '../../annotationTableHeight';
import { AnnotationTableFrame } from '../AnnotationTableFrame';

describe('AnnotationTableFrame', () => {
  it('clamps heights between the default and 75% of the viewport', () => {
    vi.stubGlobal('innerHeight', 1000);
    expect(clampAnnotationTableHeight(100)).toBe(ANNOTATION_TABLE_DEFAULT_HEIGHT);
    expect(clampAnnotationTableHeight(500)).toBe(500);
    expect(clampAnnotationTableHeight(2000)).toBe(750);
    vi.unstubAllGlobals();
  });

  it('renders an always-visible scroll area capped by the persisted height', () => {
    render(
      <AnnotationTableFrame height={520} onHeightChange={vi.fn()} belowTable={<p>footer</p>}>
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </AnnotationTableFrame>,
    );

    const scrollArea = screen.getByTestId('analysis-table-scroll-area');
    expect(scrollArea).toHaveAttribute('data-table-height', '520');
    expect(scrollArea.getAttribute('style') ?? '').toContain('520px');
    expect(screen.getByRole('separator', { name: 'Resize annotation table' })).toHaveAttribute(
      'aria-valuenow',
      '520',
    );
    expect(screen.getByText('footer')).toBeInTheDocument();
  });

  it('commits a dragged height on release and resets on double-click', () => {
    vi.stubGlobal('innerHeight', 1000);
    const onHeightChange = vi.fn();
    render(
      <AnnotationTableFrame height={null} onHeightChange={onHeightChange}>
        <div>table</div>
      </AnnotationTableFrame>,
    );

    const handle = screen.getByRole('separator', { name: 'Resize annotation table' });
    expect(handle).toHaveAttribute('aria-valuenow', String(ANNOTATION_TABLE_DEFAULT_HEIGHT));
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 260 });
    expect(handle).toHaveAttribute('aria-valuenow', String(ANNOTATION_TABLE_DEFAULT_HEIGHT + 160));
    expect(onHeightChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 260 });
    expect(onHeightChange).toHaveBeenCalledWith(ANNOTATION_TABLE_DEFAULT_HEIGHT + 160);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 5000 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 5000 });
    expect(onHeightChange).toHaveBeenLastCalledWith(750);

    fireEvent.doubleClick(handle);
    expect(onHeightChange).toHaveBeenLastCalledWith(null);
    vi.unstubAllGlobals();
  });

  it('nudges the height with the keyboard', async () => {
    const user = userEvent.setup();
    const onHeightChange = vi.fn();
    render(
      <AnnotationTableFrame height={400} onHeightChange={onHeightChange}>
        <div>table</div>
      </AnnotationTableFrame>,
    );

    const handle = screen.getByRole('separator', { name: 'Resize annotation table' });
    handle.focus();
    await user.keyboard('{ArrowDown}');
    expect(onHeightChange).toHaveBeenLastCalledWith(424);
    await user.keyboard('{ArrowUp}');
    expect(onHeightChange).toHaveBeenLastCalledWith(ANNOTATION_TABLE_DEFAULT_HEIGHT);
  });
});
