import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  const chart = {
    on: vi.fn((name: string, _query: string, handler: (event: unknown) => void) =>
      handlers.set(name, handler),
    ),
    off: vi.fn(),
    clear: vi.fn(),
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    handlers,
    chart,
    init: vi.fn((element: HTMLElement) => {
      element.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
      return chart;
    }),
    use: vi.fn(),
  };
});

vi.mock('echarts-wordcloud', () => ({}));
vi.mock('echarts/core', () => ({ init: mocks.init, use: mocks.use }));
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }));

import { ResponsiveWordCloud } from '../ResponsiveWordCloud';

describe('ResponsiveWordCloud', () => {
  let measuredWidth = 500;
  let resizeCallback: ResizeObserverCallback | null = null;

  beforeEach(() => {
    measuredWidth = 500;
    resizeCallback = null;
    mocks.handlers.clear();
    mocks.init.mockClear();
    Object.values(mocks.chart).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => measuredWidth);
    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {
        /* Triggered explicitly by the test. */
      }
      unobserve() {
        /* no-op */
      }
      disconnect() {
        /* no-op */
      }
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('maps words into a deterministic responsive SVG series and exposes it for export', () => {
    const svgRef = vi.fn();
    const { unmount } = render(
      <ResponsiveWordCloud
        words={[
          { text: 'alpha', value: 100, color: '#ff0000' },
          { text: 'beta', value: 50 },
        ]}
        color="#0000ff"
        minWidth={320}
        minHeight={300}
        aspectRatio={0.5}
        svgRef={svgRef}
        onWordClick={vi.fn()}
      />,
    );

    expect(mocks.init).toHaveBeenCalledWith(expect.any(HTMLDivElement), undefined, {
      renderer: 'svg',
    });
    expect(screen.getByRole('img', { name: 'alpha: 100, beta: 50' })).toHaveStyle({
      width: '500px',
      height: '300px',
    });
    expect(mocks.chart.resize).toHaveBeenCalledWith({ width: 500, height: 300 });
    expect(mocks.chart.clear).toHaveBeenCalledTimes(mocks.chart.setOption.mock.calls.length);
    for (const [index, clearOrder] of mocks.chart.clear.mock.invocationCallOrder.entries()) {
      expect(clearOrder).toBeLessThan(mocks.chart.setOption.mock.invocationCallOrder[index]);
    }
    expect(mocks.chart.setOption).toHaveBeenLastCalledWith(
      {
        animation: false,
        series: [
          expect.objectContaining({
            type: 'wordCloud',
            width: '100%',
            height: '100%',
            keepAspect: false,
            rotationRange: [0, 0],
            gridSize: 4,
            drawOutOfBound: false,
            shrinkToFit: true,
            layoutAnimation: false,
            silent: false,
            data: [
              expect.objectContaining({
                name: 'alpha',
                value: 100,
                textStyle: { color: '#ff0000' },
              }),
              expect.objectContaining({
                name: 'beta',
                value: 50,
                textStyle: { color: '#0000ff' },
              }),
            ],
          }),
        ],
      },
      { notMerge: true, lazyUpdate: false },
    );
    expect(svgRef).toHaveBeenLastCalledWith(expect.any(SVGSVGElement));

    measuredWidth = 700;
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.chart.clear).toHaveBeenCalledTimes(mocks.chart.setOption.mock.calls.length);
    expect(mocks.chart.resize).toHaveBeenLastCalledWith({ width: 700, height: 350 });

    unmount();
    expect(svgRef).toHaveBeenLastCalledWith(null);
    expect(mocks.chart.dispose).toHaveBeenCalledOnce();
  });

  it('forwards word events to the latest callbacks and suppresses the native context menu', () => {
    const firstClick = vi.fn();
    const firstContextMenu = vi.fn();
    const { rerender } = render(
      <ResponsiveWordCloud
        words={[{ text: 'alpha', value: 10 }]}
        onWordClick={firstClick}
        onWordContextMenu={firstContextMenu}
      />,
    );

    act(() => {
      mocks.handlers.get('click')?.({ name: 'alpha' });
      mocks.handlers.get('contextmenu')?.({ name: 'alpha' });
    });
    expect(firstClick).toHaveBeenCalledWith('alpha');
    expect(firstContextMenu).toHaveBeenCalledWith('alpha');

    const nativeEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    screen.getByRole('img').dispatchEvent(nativeEvent);
    expect(nativeEvent.defaultPrevented).toBe(true);

    const nextClick = vi.fn();
    const nextContextMenu = vi.fn();
    rerender(
      <ResponsiveWordCloud
        words={[{ text: 'alpha', value: 10 }]}
        onWordClick={nextClick}
        onWordContextMenu={nextContextMenu}
      />,
    );
    act(() => {
      mocks.handlers.get('click')?.({ name: 'alpha' });
      mocks.handlers.get('contextmenu')?.({ name: 'alpha' });
    });
    expect(nextClick).toHaveBeenCalledWith('alpha');
    expect(nextContextMenu).toHaveBeenCalledWith('alpha');
    expect(mocks.chart.on).toHaveBeenCalledTimes(2);
  });
});
