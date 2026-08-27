import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  const zrHandlers = new Map<string, (event: unknown) => void>();
  const chart = {
    on: vi.fn((name: string, handler: (event: unknown) => void) => handlers.set(name, handler)),
    off: vi.fn(),
    setOption: vi.fn(),
    dispatchAction: vi.fn(),
    containPixel: vi.fn(() => true),
    resize: vi.fn(),
    dispose: vi.fn(),
    getZr: vi.fn(() => ({
      on: vi.fn((name: string, handler: (event: unknown) => void) => zrHandlers.set(name, handler)),
      off: vi.fn(),
    })),
  };
  return {
    handlers,
    zrHandlers,
    chart,
    init: vi.fn(() => chart),
    use: vi.fn(),
  };
});

vi.mock('echarts/core', () => ({ init: mocks.init, use: mocks.use }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({
  AriaComponent: {},
  BrushComponent: {},
  DataZoomComponent: {},
  DatasetComponent: {},
  GridComponent: {},
  ToolboxComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }));

import { EChartsView } from '../EChartsView';

describe('EChartsView', () => {
  const resizeCallbacks: ResizeObserverCallback[] = [];

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.zrHandlers.clear();
    mocks.init.mockClear();
    Object.values(mocks.chart).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
    });
    resizeCallbacks.length = 0;
    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
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
    vi.unstubAllGlobals();
  });

  it('initializes one SVG chart, updates options, resizes, and disposes', () => {
    const { rerender, unmount } = render(
      <EChartsView
        option={{ series: [] }}
        height={240}
        pointCount={2}
        dataResetKey="result-a"
        ariaLabel="Test chart"
        toolbarStart={<button type="button">Download chart</button>}
      />,
    );

    expect(
      within(screen.getByRole('generic', { name: 'Chart controls' })).getByRole('button', {
        name: 'Download chart',
      }),
    ).toBeInTheDocument();

    expect(mocks.init).toHaveBeenCalledWith(expect.any(HTMLDivElement), undefined, {
      renderer: 'svg',
    });
    expect(mocks.chart.setOption).toHaveBeenCalledWith(
      expect.objectContaining({
        aria: expect.objectContaining({ enabled: true, description: 'Test chart' }),
        dataZoom: expect.arrayContaining([
          expect.objectContaining({ type: 'inside', moveOnMouseMove: false }),
          expect.objectContaining({ type: 'slider' }),
        ]),
        toolbox: { show: false },
      }),
      { notMerge: true, lazyUpdate: false },
    );

    rerender(
      <EChartsView
        option={{ series: [{ type: 'line' }] }}
        height={240}
        pointCount={2}
        dataResetKey="result-a"
        ariaLabel="Updated chart"
        toolbarStart={<button type="button">Download chart</button>}
      />,
    );
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.chart.setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({ series: [{ type: 'line' }] }),
      { notMerge: true, lazyUpdate: false },
    );

    act(() => {
      resizeCallbacks[0]?.([], {} as ResizeObserver);
    });
    expect(mocks.chart.resize).toHaveBeenCalled();
    unmount();
    expect(mocks.chart.dispose).toHaveBeenCalledOnce();
  });

  it('maps plot clicks and brush selections to complete dataset indices', () => {
    const onSelect = vi.fn();
    const onSelectRange = vi.fn();
    render(
      <EChartsView
        option={{ series: [{ type: 'line' }] }}
        height={240}
        pointCount={6}
        dataResetKey="result-a"
        ariaLabel="Selectable chart"
        onSelect={onSelect}
        onSelectRange={onSelectRange}
        getPointSummary={(index) => `Point summary ${String(index)}`}
      />,
    );

    act(() => {
      mocks.handlers.get('showtip')?.({ dataIndex: 3 });
      mocks.zrHandlers.get('click')?.({ offsetX: 120, offsetY: 80, event: { shiftKey: true } });
    });
    expect(onSelect).toHaveBeenCalledWith(3, true);
    expect(screen.getByText('Point summary 3')).toBeInTheDocument();
    expect(mocks.chart.containPixel).toHaveBeenCalledWith({ gridIndex: 0 }, [120, 80]);
    expect(mocks.chart.dispatchAction).toHaveBeenCalledWith({
      type: 'updateAxisPointer',
      x: 120,
      y: 80,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select range' }));
    act(() => {
      mocks.zrHandlers.get('mousedown')?.({ event: { shiftKey: true } });
      mocks.handlers.get('brushselected')?.({
        batch: [
          {
            selected: [{ dataIndex: [4, 2] }, { dataIndex: [2, 3] }],
          },
        ],
      });
    });
    expect(onSelectRange).toHaveBeenCalledWith(2, 4, true);
    expect(mocks.chart.dispatchAction).toHaveBeenCalledWith({ type: 'brush', areas: [] });
  });

  it('supports keyboard point navigation and accessible zoom controls', () => {
    const onSelect = vi.fn();
    render(
      <EChartsView
        option={{ series: [{ type: 'line' }] }}
        height={240}
        pointCount={3}
        dataResetKey="result-a"
        ariaLabel="Keyboard chart"
        onSelect={onSelect}
        getPointSummary={(index) => `Point ${String(index + 1)} details`}
      />,
    );

    const chart = screen.getByRole('group', { name: 'Keyboard chart' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'Enter', shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(1, true);
    expect(screen.getByText('Point 2 details')).toBeInTheDocument();
    expect(mocks.chart.dispatchAction).toHaveBeenCalledWith({
      type: 'showTip',
      seriesIndex: 0,
      dataIndex: 1,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeEnabled();
    expect(mocks.chart.dispatchAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dataZoom', dataZoomId: 'wordflow-inside-zoom' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.getByText('Chart zoom reset')).toBeInTheDocument();
  });
});
