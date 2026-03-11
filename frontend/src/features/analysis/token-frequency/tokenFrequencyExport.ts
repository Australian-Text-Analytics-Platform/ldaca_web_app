import JSZip from 'jszip';

const toSafeExportFilename = (label: string, suffix: string, extension: string) => {
  const base = (label || 'token-frequency')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'token-frequency';
  return `${base}-${suffix}.${extension}`;
};

const padFilenamePart = (value: number) => String(value).padStart(2, '0');

const buildTimestampFragment = (date: Date = new Date()) =>
  `${padFilenamePart(date.getMonth() + 1)}-${padFilenamePart(date.getDate())}_${padFilenamePart(date.getHours())}-${padFilenamePart(date.getMinutes())}-${padFilenamePart(date.getSeconds())}`;

const toRawStandaloneFilename = (label: string, suffix: string, extension: string) => {
  const base = (label || 'token-frequency').toString().trim() || 'token-frequency';
  return `${base}_${suffix}.${extension}`;
};

const toArchiveNameSegment = (label: string, maxLength = 20) => {
  const raw = (label || 'analysis').toString().trim() || 'analysis';
  const tail = raw.split('/').pop()?.trim() || raw;
  const safe = tail
    .replace(/[<>:"\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'analysis';
  const truncated = safe.slice(0, maxLength).replace(/[_\-. ]+$/g, '').trim();
  return truncated || 'analysis';
};

export const buildTokenFrequencyZipFilename = (labels: string[], date: Date = new Date()) => {
  const segments = labels
    .map((label) => toArchiveNameSegment(label))
    .filter(Boolean);
  const base = segments.length > 0 ? segments.join('_') : 'analysis';
  return `${buildTimestampFragment(date)}_${base}.zip`;
};

export type ExportedDownloadFile = {
  filename: string;
  blob: Blob;
};

const scheduleDownloadCleanup = (link: HTMLAnchorElement, urlToRevoke?: string) => {
  if (typeof window === 'undefined') return;

  window.setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    if (urlToRevoke) {
      URL.revokeObjectURL(urlToRevoke);
    }
  }, 0);
};

const triggerFileDownload = (href: string, filename: string, urlToRevoke?: string) => {
  if (typeof document === 'undefined') return;

  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);

  try {
    link.click();
  } finally {
    scheduleDownloadCleanup(link, urlToRevoke);
  }
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  triggerFileDownload(url, filename, url);
};

const downloadExportedFile = (file: ExportedDownloadFile, overrideFilename?: string) => {
  triggerBlobDownload(file.blob, overrideFilename || file.filename);
};

const DEFAULT_TOKEN_COLUMNS = ['token', 'frequency'] as const;

const deriveExportColumns = (rows: Array<Record<string, unknown>>) => {
  const seen = new Set<string>();
  const columns: string[] = [];

  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }

  if (columns.length === 0) {
    return {
      columns: [...DEFAULT_TOKEN_COLUMNS],
      isDefaultTokenFrequencyShape: true,
    };
  }

  const isDefaultTokenFrequencyShape =
    columns.length === DEFAULT_TOKEN_COLUMNS.length &&
    DEFAULT_TOKEN_COLUMNS.every((key) => seen.has(key));

  return {
    columns,
    isDefaultTokenFrequencyShape,
  };
};

const getExportHeaders = (columns: string[], isDefaultTokenFrequencyShape: boolean) => {
  if (isDefaultTokenFrequencyShape) {
    return {
      csv: ['word', 'count'],
      markdown: ['Word', 'Count'],
    };
  }

  return {
    csv: columns,
    markdown: columns,
  };
};

const toCellString = (value: unknown) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

const getRowValues = (
  row: Record<string, unknown>,
  columns: string[],
  isDefaultTokenFrequencyShape: boolean
) => {
  if (isDefaultTokenFrequencyShape) {
    return [toCellString(row?.token), toCellString(row?.frequency)];
  }

  return columns.map((column) => toCellString(row?.[column]));
};

const escapeCsvValue = (value: string) => `"${value.replace(/"/g, '""')}"`;

const escapeMarkdownValue = (value: string) => value.replace(/[\r\n]+/g, '<br />').replace(/\|/g, '\\|');

const serializeRowsAsCsv = (rows: Array<Record<string, unknown>>) => {
  const { columns, isDefaultTokenFrequencyShape } = deriveExportColumns(rows);
  const headers = getExportHeaders(columns, isDefaultTokenFrequencyShape);

  return [
    headers.csv,
    ...rows.map((row) => getRowValues(row, columns, isDefaultTokenFrequencyShape)),
  ].map((line) => line.map((value) => escapeCsvValue(toCellString(value))).join(',')).join('\r\n');
};

const serializeRowsAsMarkdown = (rows: Array<Record<string, unknown>>) => {
  const { columns, isDefaultTokenFrequencyShape } = deriveExportColumns(rows);
  const headers = getExportHeaders(columns, isDefaultTokenFrequencyShape);

  const lines = [
    `| ${headers.markdown.join(' | ')} |`,
    `| ${headers.markdown.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    const values = getRowValues(row, columns, isDefaultTokenFrequencyShape).map((value) =>
      escapeMarkdownValue(toCellString(value))
    );
    lines.push(`| ${values.join(' | ')} |`);
  }

  return lines.join('\n');
};

const renderWordCloudBitmap = (
  svgString: string,
  width: number,
  height: number,
  options: { format: Exclude<WordCloudFormat, 'svg'>; scale?: number }
) => new Promise<Blob>((resolve, reject) => {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const exportScale = options.scale ?? 3;
      const scale = Number.isFinite(exportScale) && exportScale > 1 ? exportScale : 1;
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas 2D context is not available for export'));
        return;
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (scale > 1) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (output) => {
          if (!output) {
            reject(new Error(`Failed to create ${options.format} export blob`));
            return;
          }
          resolve(output);
        },
        options.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        options.format === 'jpeg' ? 0.92 : undefined,
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to render word cloud export'));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load serialized SVG for export'));
  };

  image.src = url;
});

export const buildWordCloudExportFile = async (
  svg: SVGSVGElement,
  options: { displayName: string; fallbackKey: string; format: WordCloudFormat; scale?: number }
): Promise<ExportedDownloadFile> => {
  const { svgString, width, height } = serializeSvg(svg);
  const label = options.displayName || options.fallbackKey;

  if (options.format === 'svg') {
    return {
      filename: toSafeExportFilename(label, 'wordcloud', 'svg'),
      blob: new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }),
    };
  }

  const bitmapBlob = await renderWordCloudBitmap(svgString, width, height, {
    format: options.format,
    scale: options.scale,
  });

  return {
    filename: toSafeExportFilename(label, 'wordcloud', options.format),
    blob: bitmapBlob,
  };
};

export const buildFrequencyExportFile = (
  label: string,
  rows: Array<Record<string, unknown>>,
  format: FrequencyFormat
): ExportedDownloadFile => {
  if (format === 'markdown') {
    return {
      filename: toSafeExportFilename(label, 'frequencies', 'md'),
      blob: new Blob([serializeRowsAsMarkdown(rows)], { type: 'text/markdown;charset=utf-8;' }),
    };
  }

  return {
    filename: toSafeExportFilename(label, 'frequencies', 'csv'),
    blob: new Blob([serializeRowsAsCsv(rows)], { type: 'text/csv;charset=utf-8;' }),
  };
};

export const buildStopWordsExportFile = (stopWordsText: string, label: string): ExportedDownloadFile => {
  const words = stopWordsText
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

  return {
    filename: toSafeExportFilename(label, 'stopwords', 'txt'),
    blob: new Blob([words.join('\n')], { type: 'text/plain;charset=utf-8;' }),
  };
};

export const downloadExportBundleAsZip = async (zipFilename: string, files: ExportedDownloadFile[]) => {
  if (files.length === 0) return;
  if (files.length === 1) {
    downloadExportedFile(files[0]);
    return;
  }

  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, file.blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(zipBlob, zipFilename);
};

export const downloadWordCloudSvgAsPng = (
  svg: SVGSVGElement,
  options: {
    displayName: string;
    fallbackKey: string;
    scale?: number;
  }
) => {
  if (typeof window === 'undefined') return;

  let width = Number(svg.getAttribute('width')) || svg.clientWidth || 400;
  let height = Number(svg.getAttribute('height')) || svg.clientHeight || 200;
  const viewBox = svg.getAttribute('viewBox');

  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(' ').map((part) => Number(part));
    if (parts.length === 4) {
      width = parts[2] || width;
      height = parts[3] || height;
    }
  }

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (width) clone.setAttribute('width', String(width));
  if (height) clone.setAttribute('height', String(height));

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    const exportScale = options.scale ?? 1;
    const scale = Number.isFinite(exportScale) && exportScale > 1 ? exportScale : 1;
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      URL.revokeObjectURL(url);
      return;
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, scaledWidth, scaledHeight);
    if (scale > 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
    }
    context.drawImage(image, 0, 0, scaledWidth, scaledHeight);
    URL.revokeObjectURL(url);

    const dataUrl = canvas.toDataURL('image/png');
    triggerFileDownload(
      dataUrl,
      toRawStandaloneFilename(options.displayName || options.fallbackKey, 'wordcloud', 'png')
    );
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
  };
  image.src = url;
};

export const downloadFrequencyRowsAsCsv = (label: string, rows: Array<Record<string, unknown>>) => {
  if (typeof window === 'undefined') return;
  downloadExportedFile(buildFrequencyExportFile(label, rows, 'csv'));
};

export type WordCloudFormat = 'png' | 'jpeg' | 'svg';
export type FrequencyFormat = 'csv' | 'markdown';

const serializeSvg = (svg: SVGSVGElement): { svgString: string; width: number; height: number } => {
  let width = Number(svg.getAttribute('width')) || svg.clientWidth || 400;
  let height = Number(svg.getAttribute('height')) || svg.clientHeight || 200;
  const viewBox = svg.getAttribute('viewBox');

  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(' ').map((part) => Number(part));
    if (parts.length === 4) {
      width = parts[2] || width;
      height = parts[3] || height;
    }
  }

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (width) clone.setAttribute('width', String(width));
  if (height) clone.setAttribute('height', String(height));

  return { svgString: new XMLSerializer().serializeToString(clone), width, height };
};

export const downloadWordCloudAs = (
  svg: SVGSVGElement,
  options: { displayName: string; fallbackKey: string; format: WordCloudFormat; scale?: number }
) => {
  if (typeof window === 'undefined') return;
  if (options.format === 'svg') {
    const { svgString } = serializeSvg(svg);
    const label = options.displayName || options.fallbackKey;
    downloadExportedFile({
      filename: toSafeExportFilename(label, 'wordcloud', 'svg'),
      blob: new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }),
    }, toRawStandaloneFilename(label, 'wordcloud', 'svg'));
    return;
  }

  void buildWordCloudExportFile(svg, options).then((file) => {
    downloadExportedFile(
      file,
      toRawStandaloneFilename(options.displayName || options.fallbackKey, 'wordcloud', options.format)
    );
  });
};

export const downloadFrequencyRowsAs = (
  label: string,
  rows: Array<Record<string, unknown>>,
  format: FrequencyFormat
) => {
  if (typeof window === 'undefined') return;
  downloadExportedFile(
    buildFrequencyExportFile(label, rows, format),
    toRawStandaloneFilename(label, 'frequencies', format === 'markdown' ? 'md' : 'csv')
  );
};

export const downloadStopWordsAsTxt = (stopWordsText: string, label: string) => {
  if (typeof window === 'undefined') return;
  downloadExportedFile(
    buildStopWordsExportFile(stopWordsText, label),
    toRawStandaloneFilename(label, 'stopwords', 'txt')
  );
};
