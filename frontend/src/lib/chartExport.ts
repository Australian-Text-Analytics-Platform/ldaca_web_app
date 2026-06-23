import { saveBlob } from './download';

export type ChartImageFormat = 'svg' | 'png' | 'jpeg';

export const CHART_IMAGE_FORMATS: { value: ChartImageFormat; label: string }[] = [
  { value: 'svg', label: 'SVG' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

export interface ChartExportHeaderItem {
  label: string;
  value: string;
}
export interface ChartExportLegendItem {
  label: string;
  color: string;
  type?: 'line' | 'bar' | 'area';
  /** When true the item is rendered faded + struck-through, mirroring the web UI toggle state */
  hidden?: boolean;
}

export interface DownloadChartOptions {
  nodeName?: string;
  toolSuffix?: string;
  format: ChartImageFormat;
  scale?: number;
  header?: ChartExportHeaderItem[];
  legend?: ChartExportLegendItem[];
}

/** Builds filesystem-safe chart filenames that still identify the source node and tool. */
/** Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const toChartFilename = (
  nodeName: string,
  toolSuffix: string,
  format: ChartImageFormat,
): string => {
  const safe =
    (nodeName || 'data')
      .trim()
      .replace(/[<>:"\\|?*/]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'data';
  return `${safe}_${toolSuffix || 'chart'}.${format}`;
};

/** Escapes user/content labels before embedding them into composed SVG downloads. */
/** Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const escSvg = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Clones the chart SVG at its rendered size so export code does not mutate the live chart. */
/**
 * Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const serializeChartSvg = (
  svg: SVGSVGElement,
): { svgString: string; width: number; height: number } => {
  const rect = svg.getBoundingClientRect();
  let width = rect.width || Number(svg.getAttribute('width')) || svg.clientWidth || 800;
  let height = rect.height || Number(svg.getAttribute('height')) || svg.clientHeight || 400;
  const viewBox = svg.getAttribute('viewBox');
  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(' ').map(Number);
    if (parts.length === 4) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- fall back on 0/NaN viewBox dimensions, not only undefined
      width = parts[2] || width;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- fall back on 0/NaN viewBox dimensions, not only undefined
      height = parts[3] || height;
    }
  }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(width)));
  clone.setAttribute('height', String(Math.round(height)));
  return {
    svgString: new XMLSerializer().serializeToString(clone),
    width: Math.round(width),
    height: Math.round(height),
  };
};

// ─── Layout constants ────────────────────────────────────────────────────────

const PAD = 8;
const HEADER_TITLE_FONT = 11; // row 1: centred node name
const HEADER_TITLE_H = 16; // vertical space for title line
const HEADER_INFO_FONT = 9; // row 2: compact "Label: Value" pairs
const HEADER_INFO_H = 13; // vertical space for info line
const DIVIDER_GAP = 6;
const LEGEND_FONT = 10;
const LEGEND_ROW_H = 18;
const SWATCH_W = 16;
const SWATCH_H = 10;
const SWATCH_TEXT_GAP = 6;
const APPROX_LEGEND_ITEM_W = 140;

/** Reserves vertical space for the optional export header above the chart body. */
/** Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const computeHeaderH = (items: ChartExportHeaderItem[]): number => {
  if (!items.length) return 0;
  const hasInfo = items.length > 1;
  return PAD + HEADER_TITLE_H + (hasInfo ? HEADER_INFO_H : 0) + DIVIDER_GAP + 1 + DIVIDER_GAP;
};

/** Sizes the export legend based on chart width so SVG and bitmap exports align. */
/** Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const computeLegendH = (items: ChartExportLegendItem[], chartWidth: number): number => {
  if (!items.length) return 0;
  const perRow = Math.max(1, Math.floor(chartWidth / APPROX_LEGEND_ITEM_W));
  return Math.ceil(items.length / perRow) * LEGEND_ROW_H + PAD;
};

// ─── Canvas composite ────────────────────────────────────────────────────────

/** Rasterizes the serialized SVG into a canvas for PNG/JPEG export paths. */
/**
 * Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const drawSvgOnCanvas = (
  ctx: CanvasRenderingContext2D,
  svgString: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, x, y, w, h);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG for canvas rendering'));
    };
    img.src = url;
  });

/** Renders chart, header, and legend into a single bitmap blob for download. */
/**
 * Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const renderCompositeBitmap = async (
  svgString: string,
  svgWidth: number,
  svgHeight: number,
  options: {
    format: 'png' | 'jpeg';
    scale: number;
    header: ChartExportHeaderItem[];
    legend: ChartExportLegendItem[];
  },
): Promise<Blob> => {
  const { scale, header, legend } = options;
  const headerH = computeHeaderH(header);
  const legendH = computeLegendH(legend, svgWidth);
  const totalH = headerH + svgHeight + legendH;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(svgWidth * scale);
  canvas.height = Math.round(totalH * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(scale, scale);

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, svgWidth, totalH);

  // Header — row 1: centred node name; row 2: compact info pairs
  if (header.length) {
    const [titleItem] = header;
    ctx.font = `600 ${String(HEADER_TITLE_FONT)}px system-ui,-apple-system,sans-serif`;
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    if (titleItem) ctx.fillText(titleItem.value, svgWidth / 2, PAD + HEADER_TITLE_H);
    ctx.textAlign = 'left';

    const infoItems = header.slice(1);
    if (infoItems.length) {
      ctx.font = `${String(HEADER_INFO_FONT)}px system-ui,-apple-system,sans-serif`;
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'center';
      const colW = svgWidth / infoItems.length;
      const infoY = PAD + HEADER_TITLE_H + HEADER_INFO_H;
      for (const [i, item] of infoItems.entries()) {
        ctx.fillText(`${item.label}: ${item.value}`, PAD + i * colW + colW / 2, infoY);
      }
      ctx.textAlign = 'left';
    }

    const divY = computeHeaderH(header) - 1 - DIVIDER_GAP;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, divY);
    ctx.lineTo(svgWidth, divY);
    ctx.stroke();
  }

  // Chart
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  await drawSvgOnCanvas(ctx, svgString, 0, headerH, svgWidth, svgHeight);

  // Legend
  if (legend.length) {
    const perRow = Math.max(1, Math.floor(svgWidth / APPROX_LEGEND_ITEM_W));
    const startY = headerH + svgHeight + PAD / 2;
    ctx.font = `${String(LEGEND_FONT)}px system-ui,-apple-system,sans-serif`;

    for (const [i, item] of legend.entries()) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const rowCount = Math.min(perRow, legend.length - row * perRow);
      const xOffset = (svgWidth - rowCount * APPROX_LEGEND_ITEM_W) / 2;
      const x = xOffset + col * APPROX_LEGEND_ITEM_W;
      const cy = startY + row * LEGEND_ROW_H + LEGEND_ROW_H / 2;

      if (item.hidden) ctx.globalAlpha = 0.35;

      if (item.type === 'line') {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x + SWATCH_W, cy);
        ctx.stroke();
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(x + SWATCH_W / 2, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = item.color;
        ctx.fillRect(x, cy - SWATCH_H / 2, SWATCH_W, SWATCH_H);
      }

      const textX = x + SWATCH_W + SWATCH_TEXT_GAP;
      const textY = cy + LEGEND_FONT / 2 - 1;
      ctx.fillStyle = '#374151';
      ctx.fillText(item.label, textX, textY);

      if (item.hidden) {
        // Strikethrough line across the label text
        const textW = ctx.measureText(item.label).width;
        const strikeY = textY - LEGEND_FONT * 0.35;
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(textX, strikeY);
        ctx.lineTo(textX + textW, strikeY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to encode canvas to blob'));
      },
      options.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      options.format === 'jpeg' ? 0.92 : undefined,
    );
  });
};

// ─── SVG composite ───────────────────────────────────────────────────────────

/** Wraps the source chart SVG with export-only header and legend markup. */
/**
 * Called by: CHART_IMAGE_FORMATS and buildChartBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const buildCompositeSvg = (
  svgString: string,
  svgWidth: number,
  svgHeight: number,
  header: ChartExportHeaderItem[],
  legend: ChartExportLegendItem[],
): string => {
  const headerH = computeHeaderH(header);
  const legendH = computeLegendH(legend, svgWidth);
  const totalH = headerH + svgHeight + legendH;

  const headerLines: string[] = [];
  if (header.length) {
    const [titleItem] = header;
    const titleY = PAD + HEADER_TITLE_H;
    if (titleItem) {
      headerLines.push(
        `<text x="${String(svgWidth / 2)}" y="${String(titleY)}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${String(HEADER_TITLE_FONT)}" font-weight="600" fill="#111827">${escSvg(titleItem.value)}</text>`,
      );
    }

    const infoItems = header.slice(1);
    if (infoItems.length) {
      const infoY = PAD + HEADER_TITLE_H + HEADER_INFO_H;
      const colW = svgWidth / infoItems.length;
      for (const [i, item] of infoItems.entries()) {
        const cx = PAD + i * colW + colW / 2;
        headerLines.push(
          `<text x="${String(cx)}" y="${String(infoY)}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${String(HEADER_INFO_FONT)}" fill="#6b7280">${escSvg(item.label)}: ${escSvg(item.value)}</text>`,
        );
      }
    }

    const divY = computeHeaderH(header) - 1 - DIVIDER_GAP;
    headerLines.push(
      `<line x1="0" y1="${String(divY)}" x2="${String(svgWidth)}" y2="${String(divY)}" stroke="#e5e7eb" stroke-width="1"/>`,
    );
  }

  const legendLines: string[] = [];
  if (legend.length) {
    const perRow = Math.max(1, Math.floor(svgWidth / APPROX_LEGEND_ITEM_W));
    const startY = headerH + svgHeight + PAD / 2;
    for (const [i, item] of legend.entries()) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const rowCount = Math.min(perRow, legend.length - row * perRow);
      const xOffset = (svgWidth - rowCount * APPROX_LEGEND_ITEM_W) / 2;
      const x = xOffset + col * APPROX_LEGEND_ITEM_W;
      const cy = startY + row * LEGEND_ROW_H + LEGEND_ROW_H / 2;
      const gAttrs = item.hidden ? ' opacity="0.35"' : '';
      legendLines.push(`<g${gAttrs}>`);
      if (item.type === 'line') {
        legendLines.push(
          `<line x1="${String(x)}" y1="${String(cy)}" x2="${String(x + SWATCH_W)}" y2="${String(cy)}" stroke="${escSvg(item.color)}" stroke-width="2"/>`,
          `<circle cx="${String(x + SWATCH_W / 2)}" cy="${String(cy)}" r="3" fill="${escSvg(item.color)}"/>`,
        );
      } else {
        legendLines.push(
          `<rect x="${String(x)}" y="${String(cy - SWATCH_H / 2)}" width="${String(SWATCH_W)}" height="${String(SWATCH_H)}" rx="2" fill="${escSvg(item.color)}"/>`,
        );
      }
      const decoration = item.hidden ? ' text-decoration="line-through"' : '';
      legendLines.push(
        `<text x="${String(x + SWATCH_W + SWATCH_TEXT_GAP)}" y="${String(cy + LEGEND_FONT / 2 - 1)}" font-family="system-ui,-apple-system,sans-serif" font-size="${String(LEGEND_FONT)}" fill="#374151"${decoration}>${escSvg(item.label)}</text>`,
      );
      legendLines.push('</g>');
    }
  }

  const inner = svgString.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(svgWidth)}" height="${String(totalH)}">`,
    `<rect width="${String(svgWidth)}" height="${String(totalH)}" fill="white"/>`,
    ...headerLines,
    `<g transform="translate(0,${String(headerH)})">${inner}</g>`,
    ...legendLines,
    '</svg>',
  ].join('\n');
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a chart image blob + its intended filename without saving it.
 * Use this when you need to bundle the chart with other files (e.g. a ZIP).
 */
/**
 * Used by: src/features/views/topic-modeling/components/results/TopicModelingBubbleChartSection.tsx because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export const buildChartBlob = async (
  svg: SVGSVGElement,
  options: DownloadChartOptions,
): Promise<{ blob: Blob; filename: string }> => {
  const { svgString, width, height } = serializeChartSvg(svg);
  const filename = toChartFilename(
    options.nodeName ?? '',
    options.toolSuffix ?? 'chart',
    options.format,
  );
  const header = options.header ?? [];
  const legend = options.legend ?? [];

  if (options.format === 'svg') {
    const compositeSvg = buildCompositeSvg(svgString, width, height, header, legend);
    return {
      blob: new Blob([compositeSvg], { type: 'image/svg+xml;charset=utf-8' }),
      filename,
    };
  }

  const blob = await renderCompositeBitmap(svgString, width, height, {
    format: options.format,
    scale: options.scale ?? 2,
    header,
    legend,
  });
  return { blob, filename };
};

/** Build and immediately save a chart image, with browser/Tauri toast handling. */
/** Used by: src/features/views/concordance/components/ConcordanceDispersionSummary.tsx, src/features/views/sequential-analysis/SequentialAnalysisFeature.tsx because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export const downloadChartAs = async (
  svg: SVGSVGElement,
  options: DownloadChartOptions,
): Promise<void> => {
  const { blob, filename } = await buildChartBlob(svg, options);
  await saveBlob(blob, filename);
};

/** Finds the chart SVG inside a feature panel while ignoring icon SVGs inside controls. */
/** Used by: src/features/views/concordance/components/ConcordanceDispersionSummary.tsx, src/features/views/sequential-analysis/SequentialAnalysisFeature.tsx, src/features/views/topic-modeling/components/results/TopicModelingBubbleChartSection.tsx because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export const findSvgInContainer = (container: HTMLElement): SVGSVGElement | null => {
  const svgs = container.querySelectorAll<SVGSVGElement>('svg');
  return Array.from(svgs).find((svg) => !svg.closest('button')) ?? null;
};
