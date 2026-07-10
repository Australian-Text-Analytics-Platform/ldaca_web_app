import JSZip from 'jszip';
import { saveBlob } from '@/lib/download';

/** Creates a filesystem-safe export filename for generated token-frequency artifacts. */
/**
 * Used by token-frequency download builders in this module.
 */
const toSafeExportFilename = (label: string, suffix: string, extension: string) => {
  const base =
    (label || 'token-frequency')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'token-frequency';
  return `${base}-${suffix}.${extension}`;
};

/** Pads timestamp fragments so exported filenames sort consistently. */
/**
 * Used by token-frequency download builders in this module.
 */
const padFilenamePart = (value: number) => String(value).padStart(2, '0');

/** Builds the timestamp prefix used for grouped export archive names. */
/**
 * Called by token-frequency download builders in this module.
 */
const buildTimestampFragment = (date: Date = new Date()) =>
  `${padFilenamePart(date.getMonth() + 1)}-${padFilenamePart(date.getDate())}_${padFilenamePart(date.getHours())}-${padFilenamePart(date.getMinutes())}-${padFilenamePart(date.getSeconds())}`;

/** Preserves a human-readable standalone filename when the user downloads one file. */
/**
 * Used by token-frequency download builders in this module.
 */
const toRawStandaloneFilename = (label: string, suffix: string, extension: string) => {
  const base = (label || 'token-frequency').trim() || 'token-frequency';
  return `${base}_${suffix}.${extension}`;
};

/** Sanitizes a corpus label for use as a compact zip archive segment. */
/**
 * Used by token-frequency download builders in this module.
 * Flow: trim the label, keep the basename, replace forbidden filename characters and control codes, then truncate to a nonempty archive segment.
 */
const toArchiveNameSegment = (label: string, maxLength = 20) => {
  const raw = (label || 'analysis').trim() || 'analysis';
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty trimmed basename segment must fall back to the full raw label, so falsy '' must fall through
  const tail = raw.split('/').pop()?.trim() || raw;
  const safe =
    tail
      .split('')
      .map((char) => {
        if (char.charCodeAt(0) < 32) {
          return '_';
        }
        return /[<>:"\\|?*]/.test(char) ? '_' : char;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim() || 'analysis';
  const truncated = safe
    .slice(0, maxLength)
    .replace(/[_\-. ]+$/g, '')
    .trim();
  return truncated || 'analysis';
};

/** Names token-frequency zip bundles from selected corpus labels and capture time. */
/**
 * Used by: useTokenFrequencyDownloads and tokenFrequencyExport.test.ts because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 */
export const buildTokenFrequencyZipFilename = (labels: string[], date: Date = new Date()) => {
  const segments = labels.map((label) => toArchiveNameSegment(label)).filter(Boolean);
  const base = segments.length > 0 ? segments.join('_') : 'analysis';
  return `${buildTimestampFragment(date)}_${base}.zip`;
};

export interface ExportedDownloadFile {
  filename: string;
  blob: Blob;
}

/** Delegates blob saving to the shared browser/Tauri download adapter. */
/**
 * Used by token-frequency download builders in this module.
 */
const triggerBlobDownload = (blob: Blob, filename: string) => {
  // saveBlob handles Tauri (write to Downloads + toast) and browser (anchor)
  // paths. Fire-and-forget: callers historically had no async semantics.
  void saveBlob(blob, filename);
};

/** Downloads a prepared export file while allowing callers to override its visible filename. */
/**
 * Used by token-frequency download builders in this module.
 */
const downloadExportedFile = (file: ExportedDownloadFile, overrideFilename?: string) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty override filename must fall back to the file's own name, so falsy '' must fall through
  triggerBlobDownload(file.blob, overrideFilename || file.filename);
};

const DEFAULT_TOKEN_COLUMNS = ['token', 'frequency'] as const;

/** Infers stable export columns from result rows while preserving the default token shape. */
/**
 * Called by token-frequency download builders in this module.
 * Flow: collect first-seen row keys across all rows, fall back to token/frequency defaults when empty, then flag the default token shape.
 */
const deriveExportColumns = (rows: Record<string, unknown>[]) => {
  const seen = new Set<string>();
  const columns: string[] = [];

  for (const row of rows) {
    for (const key of Object.keys(row)) {
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

/** Selects human-facing headers for CSV and Markdown export formats. */
/**
 * Called by token-frequency download builders in this module.
 */
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

/** Converts unknown row values into export-safe cell text. */
/**
 * Used by token-frequency download builders in this module.
 */
const toCellString = (value: unknown) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
};

/** Orders row values according to the derived export columns and default token headers. */
/**
 * Called by token-frequency download builders in this module.
 */
const getRowValues = (
  row: Record<string, unknown>,
  columns: string[],
  isDefaultTokenFrequencyShape: boolean,
) => {
  if (isDefaultTokenFrequencyShape) {
    return [toCellString(row.token), toCellString(row.frequency)];
  }

  return columns.map((column) => toCellString(row[column]));
};

/** Escapes a value for RFC-style quoted CSV output. */
/**
 * Used by token-frequency download builders in this module.
 */
const escapeCsvValue = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Escapes a value for Markdown table cells shown in exported reports. */
/**
 * Used by token-frequency download builders in this module.
 */
const escapeMarkdownValue = (value: string) =>
  value.replace(/[\r\n]+/g, '<br />').replace(/\|/g, '\\|');

/** Serializes frequency rows into CSV for spreadsheet-friendly downloads. */
/**
 * Used by token-frequency download builders in this module.
 */
const serializeRowsAsCsv = (rows: Record<string, unknown>[]) => {
  const { columns, isDefaultTokenFrequencyShape } = deriveExportColumns(rows);
  const headers = getExportHeaders(columns, isDefaultTokenFrequencyShape);

  return [
    headers.csv,
    ...rows.map((row) => getRowValues(row, columns, isDefaultTokenFrequencyShape)),
  ]
    .map((line) => line.map((value) => escapeCsvValue(toCellString(value))).join(','))
    .join('\r\n');
};

/** Serializes frequency rows into a Markdown table for document-friendly downloads. */
/**
 * Used by token-frequency download builders in this module.
 * Flow: derive columns and headers, write the Markdown header and separator rows, escape each cell, then join table lines.
 */
const serializeRowsAsMarkdown = (rows: Record<string, unknown>[]) => {
  const { columns, isDefaultTokenFrequencyShape } = deriveExportColumns(rows);
  const headers = getExportHeaders(columns, isDefaultTokenFrequencyShape);

  const lines = [
    `| ${headers.markdown.join(' | ')} |`,
    `| ${headers.markdown.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    const values = getRowValues(row, columns, isDefaultTokenFrequencyShape).map((value) =>
      escapeMarkdownValue(toCellString(value)),
    );
    lines.push(`| ${values.join(' | ')} |`);
  }

  return lines.join('\n');
};

/** Renders a serialized SVG word cloud into a bitmap blob for PNG and JPEG exports. */
/**
 * Used by token-frequency download builders in this module.
 * Flow: derive export names and columns, serialize rows or assets, build Blob/zip payloads, then delegate the browser/Tauri download.
 */
const renderWordCloudBitmap = (
  svgString: string,
  width: number,
  height: number,
  options: { format: Exclude<WordCloudFormat, 'svg'>; scale?: number },
) =>
  new Promise<Blob>((resolve, reject) => {
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

/** Builds a word-cloud export file in the requested image format. */
/**
 * Used by: useTokenFrequencyDownloads because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 * Flow: serialize the SVG and dimensions, return raw SVG when requested, otherwise render a bitmap blob and build the export filename.
 */
export const buildWordCloudExportFile = async (
  svg: SVGSVGElement,
  options: { displayName: string; fallbackKey: string; format: WordCloudFormat; scale?: number },
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

/** Builds a frequency-table export file for either CSV or Markdown delivery. */
/**
 * Used by: useTokenFrequencyDownloads and tokenFrequencyExport.test.ts because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 */
export const buildFrequencyExportFile = (
  label: string,
  rows: Record<string, unknown>[],
  format: FrequencyFormat,
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

/** Builds a plain-text stop-word export to accompany analysis downloads. */
/**
 * Used by: useTokenFrequencyDownloads and tokenFrequencyExport.test.ts because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 */
export const buildStopWordsExportFile = (
  stopWordsText: string,
  label: string,
): ExportedDownloadFile => {
  const words = stopWordsText
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

  return {
    filename: toSafeExportFilename(label, 'stopwords', 'txt'),
    blob: new Blob([words.join('\n')], { type: 'text/plain;charset=utf-8;' }),
  };
};

/** Downloads multiple prepared files as a zip bundle, or a single file directly. */
/**
 * Used by: useTokenFrequencyDownloads and tokenFrequencyExport.test.ts because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 */
export const downloadExportBundleAsZip = async (
  zipFilename: string,
  files: ExportedDownloadFile[],
) => {
  if (files.length === 0) return;
  if (files.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length === 1 checked above guarantees index 0 exists
    downloadExportedFile(files[0]!);
    return;
  }

  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, file.blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(zipBlob, zipFilename);
};

export type WordCloudFormat = 'png' | 'jpeg' | 'svg';
export type FrequencyFormat = 'csv' | 'markdown';

/** Serializes the live word-cloud SVG with concrete dimensions for export rendering. */
/**
 * Used by token-frequency download builders in this module.
 * Flow: read explicit/client/viewBox dimensions, clone the SVG with xmlns and dimensions, then serialize it with XMLSerializer.
 */
const serializeSvg = (svg: SVGSVGElement): { svgString: string; width: number; height: number } => {
  let width = Number(svg.getAttribute('width')) || svg.clientWidth || 400;
  let height = Number(svg.getAttribute('height')) || svg.clientHeight || 200;
  const viewBox = svg.getAttribute('viewBox');

  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(' ').map((part) => Number(part));
    if (parts.length === 4) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a 0/NaN viewBox dimension must fall back to the existing width, so falsy values must fall through (?? would keep them)
      width = parts[2] || width;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a 0/NaN viewBox dimension must fall back to the existing height, so falsy values must fall through (?? would keep them)
      height = parts[3] || height;
    }
  }

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (width) clone.setAttribute('width', String(width));
  if (height) clone.setAttribute('height', String(height));

  return { svgString: new XMLSerializer().serializeToString(clone), width, height };
};

/** Downloads a word cloud as SVG directly or as a rendered bitmap file. */
/**
 * Used by: useTokenFrequencyDownloads and tokenFrequencyExport.test.ts because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 * Flow: no-op outside browsers, download serialized SVG directly for SVG format, otherwise render a bitmap export and trigger the file download.
 */
export const downloadWordCloudAs = (
  svg: SVGSVGElement,
  options: { displayName: string; fallbackKey: string; format: WordCloudFormat; scale?: number },
) => {
  if (typeof window === 'undefined') return;
  if (options.format === 'svg') {
    const { svgString } = serializeSvg(svg);
    const label = options.displayName || options.fallbackKey;
    downloadExportedFile(
      {
        filename: toSafeExportFilename(label, 'wordcloud', 'svg'),
        blob: new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }),
      },
      toRawStandaloneFilename(label, 'wordcloud', 'svg'),
    );
    return;
  }

  void buildWordCloudExportFile(svg, options).then((file) => {
    downloadExportedFile(
      file,
      toRawStandaloneFilename(
        options.displayName || options.fallbackKey,
        'wordcloud',
        options.format,
      ),
    );
  });
};

/** Downloads frequency rows using the user-selected text export format. */
/**
 * Used by: tokenFrequencyExport.test.ts and useTokenFrequencyDownloads because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 */
export const downloadFrequencyRowsAs = (
  label: string,
  rows: Record<string, unknown>[],
  format: FrequencyFormat,
) => {
  if (typeof window === 'undefined') return;
  downloadExportedFile(
    buildFrequencyExportFile(label, rows, format),
    toRawStandaloneFilename(label, 'frequencies', format === 'markdown' ? 'md' : 'csv'),
  );
};

/** Downloads the active stop-word list as a standalone text file. */
/**
 * Used by: useTokenFrequencyDownloads because token-frequency downloads need consistent filename, serialization, and Blob-building behavior across direct and zip exports.
 */
export const downloadStopWordsAsTxt = (stopWordsText: string, label: string) => {
  if (typeof window === 'undefined') return;
  downloadExportedFile(
    buildStopWordsExportFile(stopWordsText, label),
    toRawStandaloneFilename(label, 'stopwords', 'txt'),
  );
};
