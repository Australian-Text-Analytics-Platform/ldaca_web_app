import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFrequencyExportFile,
  buildStopWordsExportFile,
  downloadExportBundleAsZip,
  downloadFrequencyRowsAs,
  downloadWordCloudAs,
} from '../tokenFrequencyExport';

describe('tokenFrequencyExport', () => {
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;
  let clickMock: ReturnType<typeof vi.fn>;
  let usingFakeTimers: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    usingFakeTimers = true;
    createObjectURLMock = vi.fn(() => 'blob:mock-export-url');
    revokeObjectURLMock = vi.fn();
    clickMock = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURLMock,
    });

    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock,
    });

    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: clickMock,
    });
  });

  afterEach(() => {
    if (usingFakeTimers) {
      vi.runOnlyPendingTimers();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps csv download anchors in the DOM until deferred cleanup and then revokes the object URL', () => {
    createObjectURLMock.mockReturnValueOnce('blob:csv-export');

    downloadFrequencyRowsAs('My Corpus', [{ token: 'alpha', frequency: 3 }], 'csv');

    const link = document.body.querySelector('a[download="my-corpus-frequencies.csv"]');

    expect(link).toBeInTheDocument();
    expect(clickMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(document.body.querySelector('a[download="my-corpus-frequencies.csv"]')).not.toBeInTheDocument();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:csv-export');
  });

  it('exports markdown using all available comparative statistics columns', async () => {
    const capturedBlobs: Blob[] = [];
    createObjectURLMock.mockImplementationOnce((blob: Blob) => {
      capturedBlobs.push(blob);
      return 'blob:markdown-export';
    });

    downloadFrequencyRowsAs(
      'Token Keyness',
      [
        {
          token: 'alpha',
          freq_corpus_0: 12,
          percent_corpus_0: 0.6,
          significance: '**',
        },
        {
          token: 'beta',
          freq_corpus_0: 8,
          percent_corpus_0: 0.4,
          significance: '*',
          freq_corpus_1: 7,
          note: 'left|right\nnext',
        },
      ],
      'markdown'
    );

    const markdown = await capturedBlobs[0].text();

    expect(markdown).toContain(
      '| token | freq_corpus_0 | percent_corpus_0 | significance | freq_corpus_1 | note |'
    );
    expect(markdown).toContain('| alpha | 12 | 0.6 | ** |  |  |');
    expect(markdown).toContain('| beta | 8 | 0.4 | * | 7 | left\\|right<br />next |');
  });

  it('keeps svg word cloud download anchors in the DOM until deferred cleanup and uses the expected filename', () => {
    createObjectURLMock.mockReturnValueOnce('blob:svg-export');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '320');
    svg.setAttribute('height', '180');

    downloadWordCloudAs(svg, {
      displayName: 'Sample Node',
      fallbackKey: 'sample-node',
      format: 'svg',
    });

    const link = document.body.querySelector('a[download="sample-node-wordcloud.svg"]');

    expect(link).toBeInTheDocument();
    expect(clickMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(document.body.querySelector('a[download="sample-node-wordcloud.svg"]')).not.toBeInTheDocument();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:svg-export');
  });

  it('bundles a primary export and stop words into a single zip download', async () => {
    vi.useRealTimers();
    usingFakeTimers = false;
    createObjectURLMock.mockReturnValueOnce('blob:zip-export');

    await downloadExportBundleAsZip('My Corpus', [
      buildFrequencyExportFile('My Corpus', [{ token: 'alpha', frequency: 3 }], 'csv'),
      buildStopWordsExportFile('the, and', 'My Corpus'),
    ]);

    const link = document.body.querySelector('a[download="my-corpus-download.zip"]');
    expect(link).toBeInTheDocument();
    expect(clickMock).toHaveBeenCalledTimes(1);

    const zipBlob = createObjectURLMock.mock.calls[0][0] as Blob;
    const zip = await JSZip.loadAsync(zipBlob);

    expect(Object.keys(zip.files).sort()).toEqual([
      'my-corpus-frequencies.csv',
      'my-corpus-stopwords.txt',
    ]);
    expect(await zip.file('my-corpus-frequencies.csv')?.async('string')).toBe('"word","count"\r\n"alpha","3"');
    expect(await zip.file('my-corpus-stopwords.txt')?.async('string')).toBe('the\nand');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.body.querySelector('a[download="my-corpus-download.zip"]')).not.toBeInTheDocument();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:zip-export');
  });
});