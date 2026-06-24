import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFrequencyExportFile,
  buildStopWordsExportFile,
  buildTokenFrequencyZipFilename,
  buildWordCloudExportFile,
  downloadExportBundleAsZip,
  downloadFrequencyRowsAs,
} from '../../tokenFrequencyExport';
import { useTokenFrequencyDownloads } from '../useTokenFrequencyDownloads';

vi.mock('../../tokenFrequencyExport', () => ({
  buildFrequencyExportFile: vi.fn((label: string, rows: unknown[], format: string) => ({
    filename: `${label}.${format}`,
    blob: new Blob([JSON.stringify(rows)]),
  })),
  buildStopWordsExportFile: vi.fn((stopWords: string, label: string) => ({
    filename: `${label}.stopwords.txt`,
    blob: new Blob([stopWords]),
  })),
  buildTokenFrequencyZipFilename: vi.fn((labels: string[]) => `zip:${labels.join('|')}`),
  buildWordCloudExportFile: vi.fn(() =>
    Promise.resolve({
      filename: 'wordcloud.svg',
      blob: new Blob(['<svg />']),
    }),
  ),
  downloadExportBundleAsZip: vi.fn(() => Promise.resolve(undefined)),
  downloadFrequencyRowsAs: vi.fn(),
  downloadStopWordsAsTxt: vi.fn(),
  downloadWordCloudAs: vi.fn(),
}));

const mockedBuildFrequencyExportFile = vi.mocked(buildFrequencyExportFile);
const mockedBuildStopWordsExportFile = vi.mocked(buildStopWordsExportFile);
const mockedBuildTokenFrequencyZipFilename = vi.mocked(buildTokenFrequencyZipFilename);
const mockedBuildWordCloudExportFile = vi.mocked(buildWordCloudExportFile);
const mockedDownloadExportBundleAsZip = vi.mocked(downloadExportBundleAsZip);
const mockedDownloadFrequencyRowsAs = vi.mocked(downloadFrequencyRowsAs);

const computeDisplayName = (nodeId: string, fallbackKey?: string) => {
  if (nodeId === 'reference-node') return 'Reference Corpus';
  if (nodeId === 'study-node') return 'Study Corpus';
  return fallbackKey ?? nodeId;
};

describe('useTokenFrequencyDownloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bundles unified word-cloud exports with stop words using comparison labels', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const { result } = renderHook(() =>
      useTokenFrequencyDownloads({
        analysisNodeIds: ['reference-node', 'study-node'],
        computeDisplayName,
        stopWords: 'the, and',
      }),
    );

    act(() => {
      result.current.registerWordCloudRef('unified', svg);
      result.current.openWordCloudDownload('unified', 'Unified keyness');
    });

    expect(result.current.downloadDialogOpen).toBe(true);
    expect(result.current.downloadDialogMode).toBe('wordcloud');

    await act(async () => {
      await result.current.confirmDownload({ format: 'svg', includeStopWords: true });
    });

    expect(mockedBuildWordCloudExportFile).toHaveBeenCalledWith(svg, {
      displayName: 'Unified keyness',
      fallbackKey: 'unified',
      format: 'svg',
      scale: 3,
    });
    expect(mockedBuildTokenFrequencyZipFilename).toHaveBeenCalledWith([
      'Reference Corpus',
      'Study Corpus',
    ]);
    expect(mockedBuildStopWordsExportFile).toHaveBeenCalledWith('the, and', 'Unified keyness');
    expect(mockedDownloadExportBundleAsZip).toHaveBeenCalledWith(
      'zip:Reference Corpus|Study Corpus',
      [
        { filename: 'wordcloud.svg', blob: expect.any(Blob) },
        { filename: 'Unified keyness.stopwords.txt', blob: expect.any(Blob) },
      ],
    );
    expect(result.current.downloadDialogOpen).toBe(false);
  });

  it('renames keyness statistic columns before frequency export', async () => {
    const { result } = renderHook(() =>
      useTokenFrequencyDownloads({
        analysisNodeIds: ['reference-node', 'study-node'],
        computeDisplayName,
        stopWords: '',
      }),
    );

    act(() => {
      result.current.openFrequencyDownload('token-keyness', [
        {
          token: 'alpha',
          freq_reference: 12,
          freq_study: 8,
          percent_reference: 0.6,
          percent_study: 0.4,
          expected_reference: 10,
          expected_study: 10,
          reference_total: 100,
          study_total: 80,
          overuse: false,
          signed_ll: -2.5,
        },
      ]);
    });

    expect(result.current.downloadDialogOpen).toBe(true);
    expect(result.current.downloadDialogMode).toBe('frequencies');

    await act(async () => {
      await result.current.confirmDownload({ format: 'csv', includeStopWords: false });
    });

    expect(mockedDownloadFrequencyRowsAs).toHaveBeenCalledWith(
      'token-keyness',
      [
        {
          token: 'alpha',
          'OR_Reference Corpus': 12,
          'OS_Study Corpus': 8,
          '%R_Reference Corpus': 0.6,
          '%S_Study Corpus': 0.4,
          'E_Reference Corpus': 10,
          'E_Study Corpus': 10,
          'Total_Reference Corpus': 100,
          'Total_Study Corpus': 80,
          Overuse: false,
          Signed_LL: -2.5,
        },
      ],
      'csv',
    );
    expect(mockedBuildFrequencyExportFile).not.toHaveBeenCalled();
    expect(mockedDownloadExportBundleAsZip).not.toHaveBeenCalled();
  });
});
