import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildChartBlob, findSvgInContainer } from '../chartExport';

const createChartSvg = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '640');
  svg.setAttribute('height', '240');
  svg.innerHTML = [
    '<defs><clipPath id="clip"><rect width="640" height="240" /></clipPath></defs>',
    '<style>.series{stroke:#123456;fill:none}</style>',
    '<path class="series" clip-path="url(#clip)" d="M0 10 L640 20" />',
  ].join('');
  return svg;
};

describe('chartExport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves ECharts SVG definitions and styles in composed SVG output', async () => {
    const { blob, filename } = await buildChartBlob(createChartSvg(), {
      nodeName: 'Corpus',
      toolSuffix: 'trends',
      format: 'svg',
      header: [{ label: 'Title', value: 'Trends' }],
      legend: [{ label: 'Alpha', color: '#123456', type: 'line' }],
    });
    const text = await blob.text();

    expect(filename).toBe('Corpus_trends.svg');
    expect(text).toContain('<clipPath id="clip">');
    expect(text).toContain('.series{stroke:#123456;fill:none}');
    expect(text).toContain('Trends');
    expect(text).toContain('Alpha');
  });

  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
  ] as const)('rasterizes ECharts SVG for %s output', async (format, mimeType) => {
    const context = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob(['bitmap'], { type: type ?? mimeType }));
    });
    vi.stubGlobal(
      'Image',
      class TestImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-chart');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { blob } = await buildChartBlob(createChartSvg(), {
      nodeName: 'Corpus',
      toolSuffix: 'trends',
      format,
    });

    expect(blob.type).toBe(mimeType);
    expect(context.drawImage).toHaveBeenCalled();
  });

  it('finds the chart SVG while ignoring control icons', () => {
    const container = document.createElement('div');
    const button = document.createElement('button');
    button.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    const chart = createChartSvg();
    container.append(button, chart);

    expect(findSvgInContainer(container)).toBe(chart);
  });
});
