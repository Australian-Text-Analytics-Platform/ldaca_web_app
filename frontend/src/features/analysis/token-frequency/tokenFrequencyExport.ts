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

const triggerFileDownload = (href: string, filename: string) => {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  triggerFileDownload(url, filename);
  if (typeof window !== 'undefined') window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
      toSafeExportFilename(options.displayName || options.fallbackKey, 'wordcloud', 'png')
    );
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
  };
  image.src = url;
};

export const downloadFrequencyRowsAsCsv = (label: string, rows: Array<Record<string, unknown>>) => {
  if (typeof window === 'undefined') return;
  const csvLines = [
    ['word', 'count'],
    ...rows.map((item) => [
      String(item?.token ?? ''),
      String(item?.frequency ?? ''),
    ]),
  ].map((line) =>
    line
      .map((value) => {
        const str = String(value).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(',')
  );

  const csvContent = csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(blob, toSafeExportFilename(label, 'frequencies', 'csv'));
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
  const { svgString, width, height } = serializeSvg(svg);
  const label = options.displayName || options.fallbackKey;

  if (options.format === 'svg') {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    triggerBlobDownload(blob, toSafeExportFilename(label, 'wordcloud', 'svg'));
    return;
  }

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  image.onload = () => {
    const canvas = document.createElement('canvas');
    const exportScale = options.scale ?? 3;
    const scale = Number.isFinite(exportScale) && exportScale > 1 ? exportScale : 1;
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext('2d');
    if (!context) { URL.revokeObjectURL(url); return; }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (scale > 1) { context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mimeType, options.format === 'jpeg' ? 0.92 : undefined);
    triggerFileDownload(dataUrl, toSafeExportFilename(label, 'wordcloud', options.format));
  };

  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
};

export const downloadFrequencyRowsAs = (
  label: string,
  rows: Array<Record<string, unknown>>,
  format: FrequencyFormat
) => {
  if (typeof window === 'undefined') return;

  if (format === 'markdown') {
    const lines = ['| Word | Count |', '| --- | --- |'];
    for (const item of rows) {
      const word = String(item?.token ?? '').replace(/\|/g, '\\|');
      const count = String(item?.frequency ?? '');
      lines.push(`| ${word} | ${count} |`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    triggerBlobDownload(blob, toSafeExportFilename(label, 'frequencies', 'md'));
    return;
  }

  downloadFrequencyRowsAsCsv(label, rows);
};

export const downloadStopWordsAsTxt = (stopWordsText: string, label: string) => {
  if (typeof window === 'undefined') return;
  const words = stopWordsText
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  const blob = new Blob([words.join('\n')], { type: 'text/plain;charset=utf-8;' });
  triggerBlobDownload(blob, toSafeExportFilename(label, 'stopwords', 'txt'));
};
