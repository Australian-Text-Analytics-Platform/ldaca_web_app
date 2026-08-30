import { useCallback, useRef, useState } from 'react';
import {
  buildFrequencyExportFile,
  buildStopWordsExportFile,
  buildTokenFrequencyZipFilename,
  buildWordCloudExportFile,
  downloadExportBundleAsZip,
  downloadFrequencyRowsAs,
  downloadStopWordsAsTxt,
  downloadWordCloudAs,
  type FrequencyFormat,
  type WordCloudFormat,
} from '../tokenFrequencyExport';
import type { DownloadDialogMode } from '../components/TokenFrequencyDownloadDialog';

interface PendingDownloadContext {
  mode: DownloadDialogMode;
  nodeKey?: string;
  displayName?: string;
  rows?: unknown[];
  label?: string;
}

interface UseTokenFrequencyDownloadsArgs {
  stopWords: string;
  analysisNodeIds: string[];
  computeDisplayName: (nodeId: string, fallbackKey?: string) => string;
}

/** Returns the first nonempty label because export filenames should not preserve blank labels. */
const firstNonEmptyLabel = (values: (string | null | undefined)[], fallback: string) => {
  for (const value of values) {
    if (value) return value;
  }
  return fallback;
};

/**
 * Owns token-frequency download dialog state and export dispatch.
 * Used by: useTokenFrequencyResultModel because export pending state, SVG refs,
 * and stop-word bundling are one result workflow that should not live inline
 * with task hydration and analysis orchestration.
 * Flow: register rendered word-cloud SVGs, open the dialog with a pending
 * download context, optionally rename comparative statistics for export, then
 * dispatch a standalone download or zip bundle when the dialog confirms.
 */
export const useTokenFrequencyDownloads = ({
  stopWords,
  analysisNodeIds,
  computeDisplayName,
}: UseTokenFrequencyDownloadsArgs) => {
  const wordCloudRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const pendingDownloadRef = useRef<PendingDownloadContext | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadDialogMode, setDownloadDialogMode] = useState<DownloadDialogMode>('wordcloud');

  const registerWordCloudRef = useCallback((nodeKey: string, element: SVGSVGElement | null) => {
    if (!element) {
      Reflect.deleteProperty(wordCloudRefs.current, nodeKey);
      return;
    }
    wordCloudRefs.current[nodeKey] = element;
  }, []);

  const openWordCloudDownload = useCallback((nodeKey: string, displayName: string) => {
    pendingDownloadRef.current = { mode: 'wordcloud', nodeKey, displayName };
    setDownloadDialogMode('wordcloud');
    setDownloadDialogOpen(true);
  }, []);

  const renameStatisticsKeysForExport = useCallback(
    (rows: unknown[]): unknown[] => {
      if (analysisNodeIds.length !== 2) return rows;
      const [referenceNodeId, studyNodeId] = analysisNodeIds;
      if (!referenceNodeId || !studyNodeId) return rows;

      const referenceName = computeDisplayName(referenceNodeId, 'reference');
      const studyName = computeDisplayName(studyNodeId, 'study');
      const keyMap: Record<string, string> = {
        freq_reference: `OR_${referenceName}`,
        freq_study: `OS_${studyName}`,
        percent_reference: `%R_${referenceName}`,
        percent_study: `%S_${studyName}`,
        expected_reference: `E_${referenceName}`,
        expected_study: `E_${studyName}`,
        reference_total: `Total_${referenceName}`,
        study_total: `Total_${studyName}`,
        overuse: 'Overuse',
        signed_ll: 'Signed_LL',
      };

      return rows.map((row) => {
        if (!row || typeof row !== 'object') return row;
        const source = row as Record<string, unknown>;
        const renamed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(source)) {
          renamed[keyMap[key] ?? key] = value;
        }
        return renamed;
      });
    },
    [analysisNodeIds, computeDisplayName],
  );

  const openFrequencyDownload = useCallback(
    (label: string, rows: unknown[]) => {
      const exportRows = label === 'token-keyness' ? renameStatisticsKeysForExport(rows) : rows;
      pendingDownloadRef.current = { mode: 'frequencies', label, rows: exportRows };
      setDownloadDialogMode('frequencies');
      setDownloadDialogOpen(true);
    },
    [renameStatisticsKeysForExport],
  );

  const confirmDownload = useCallback(
    async ({ format, includeStopWords }: { format: string; includeStopWords: boolean }) => {
      const ctx = pendingDownloadRef.current;
      if (!ctx) return;

      const archiveLabel = firstNonEmptyLabel(
        [ctx.label, ctx.displayName, ctx.nodeKey],
        'analysis',
      );
      const shouldBundleStopWords = includeStopWords && Boolean(stopWords);
      const comparisonArchiveLabels = analysisNodeIds
        .slice(0, 2)
        .map((nodeId, index) => computeDisplayName(nodeId, `node-${String(index + 1)}`));

      try {
        if (ctx.mode === 'wordcloud' && ctx.nodeKey) {
          const svg = wordCloudRefs.current[ctx.nodeKey];
          if (svg) {
            if (shouldBundleStopWords) {
              const displayName = firstNonEmptyLabel([ctx.displayName, ctx.nodeKey], ctx.nodeKey);
              const primaryFile = await buildWordCloudExportFile(svg, {
                displayName,
                fallbackKey: ctx.nodeKey,
                format: format as WordCloudFormat,
                scale: 3,
              });

              const zipFilename =
                ctx.nodeKey === 'unified'
                  ? buildTokenFrequencyZipFilename(comparisonArchiveLabels)
                  : buildTokenFrequencyZipFilename([archiveLabel]);

              await downloadExportBundleAsZip(zipFilename, [
                primaryFile,
                buildStopWordsExportFile(stopWords, archiveLabel),
              ]);
            } else {
              const displayName = firstNonEmptyLabel([ctx.displayName, ctx.nodeKey], ctx.nodeKey);
              downloadWordCloudAs(svg, {
                displayName,
                fallbackKey: ctx.nodeKey,
                format: format as WordCloudFormat,
                scale: 3,
              });
            }
          }
        } else if (ctx.mode === 'frequencies' && ctx.rows) {
          if (shouldBundleStopWords) {
            const frequencyLabel = firstNonEmptyLabel([ctx.label], 'frequencies');
            await downloadExportBundleAsZip(buildTokenFrequencyZipFilename([archiveLabel]), [
              buildFrequencyExportFile(
                frequencyLabel,
                ctx.rows as Record<string, unknown>[],
                format as FrequencyFormat,
              ),
              buildStopWordsExportFile(stopWords, archiveLabel),
            ]);
          } else {
            const frequencyLabel = firstNonEmptyLabel([ctx.label], 'frequencies');
            downloadFrequencyRowsAs(
              frequencyLabel,
              ctx.rows as Record<string, unknown>[],
              format as FrequencyFormat,
            );
          }
        } else if (shouldBundleStopWords) {
          downloadStopWordsAsTxt(stopWords, archiveLabel);
        }
      } finally {
        pendingDownloadRef.current = null;
        setDownloadDialogOpen(false);
      }
    },
    [analysisNodeIds, computeDisplayName, stopWords],
  );

  return {
    downloadDialogOpen,
    setDownloadDialogOpen,
    downloadDialogMode,
    registerWordCloudRef,
    openWordCloudDownload,
    openFrequencyDownload,
    confirmDownload,
  };
};
