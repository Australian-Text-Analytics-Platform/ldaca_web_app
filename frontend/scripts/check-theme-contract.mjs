import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../src/', import.meta.url);
const allowedFunctionalGradients = new Set([
  'features/workspace/data-view/components/WorkspaceDataHeader.tsx',
]);
const allowedRawColorFiles = new Set([
  'features/theme/themeRuntime.ts',
  'features/views/common/components/MultiSeriesChart.tsx',
  'features/views/common/components/NodeColorPicker.tsx',
  'features/views/common/components/NodeSelectionList.tsx',
  'features/views/common/vizPalette.ts',
  'features/views/concordance/components/ConcordanceDispersionCell.tsx',
  'features/views/concordance/components/ConcordanceDispersionSummary.tsx',
  'features/views/concordance/components/ConcordanceResultsPanel.tsx',
  'features/views/concordance/components/ConcordanceRowsTable.tsx',
  'features/views/concordance/concordanceSourceDomain.ts',
  'features/views/preprocessing/concat/hooks/useConcatSubTab.ts',
  'features/views/preprocessing/expression/hooks/useTypedExpressionSubTab.ts',
  'features/views/preprocessing/join/hooks/useJoinSubTab.ts',
  'features/views/quotation/components/QuotationHighlightedCell.tsx',
  'features/views/quotation/components/quotationDetailText.tsx',
  'features/views/quotation/quotationResultsModel.ts',
  'features/views/sequential-analysis/hooks/sequentialChartModel.ts',
  'features/views/topic-modeling/components/results/TopicModelingFlowChart.tsx',
  'features/views/topic-modeling/components/results/TopicSizeComposition.tsx',
  'features/views/topic-modeling/components/results/topicModelingGraph.ts',
  'features/views/topic-modeling/topicModelingAdapters.ts',
  'features/views/token-frequency/TokenFrequencyFeature.tsx',
  'features/views/token-frequency/tokenFrequencyExport.ts',
  'features/workspace/data-view/components/TopicDistributionBar.tsx',
  'lib/chartExport.ts',
]);

const checks = [
  ['legacy CSS variable', /var\(--(?:background|card|primary|popover|radius|input|ring|muted-foreground)\b/],
  [
    'legacy Tailwind color mapping',
    /--color-(?:background|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|border|input|ring)\s*:/,
  ],
  [
    'legacy utility alias',
    /\b(?:bg|text|border|ring|fill|stroke)-(?:background|card-foreground|card|popover-foreground|popover|primary-foreground|primary|secondary-foreground|secondary|muted-foreground|muted|accent-foreground|accent|destructive-foreground|destructive|input|ring)(?![-\w])/,
  ],
  ['legacy dark class', /(?:^|[\s"'`])(?:\.dark\b|dark:)/m],
  [
    'hardcoded Tailwind presentation palette',
    /\b(?:text|bg|border|from|via|to|fill|stroke)-(?:gray|slate|blue|red|amber|green|sky|emerald|yellow)-\d+/,
  ],
  ['decorative blur', /\bbackdrop-blur(?:-\S+)?/],
  ['non-overlay elevation', /\bshadow-(?:sm|md|lg|xl|2xl)\b/],
  ['off-system radius', /\brounded-(?:xl|2xl|3xl)\b/],
  ['off-system typography', /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/],
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'styles') continue;
      files.push(...(await sourceFiles(path)));
    } else if (['.ts', '.tsx', '.css'].includes(extname(entry.name)) && !entry.name.includes('.test.')) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const path of await sourceFiles(root.pathname)) {
  const source = await readFile(path, 'utf8');
  const displayPath = relative(root.pathname, path);
  for (const [label, pattern] of checks) {
    if (label === 'non-overlay elevation') {
      const withoutApprovedOverlay = source
        .replaceAll('shadow-[var(--vscode-shadow-lg)]', '')
        .replaceAll('var(--vscode-shadow-lg)', '');
      if (pattern.test(withoutApprovedOverlay)) violations.push(`${displayPath}: ${label}`);
      continue;
    }
    if (pattern.test(source)) violations.push(`${displayPath}: ${label}`);
  }
  if (source.includes('bg-linear') && !allowedFunctionalGradients.has(displayPath)) {
    violations.push(`${displayPath}: decorative gradient`);
  }
  if (
    /(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:text|bg|border|fill|stroke)-(?:black|white)\b)/.test(
      source,
    ) &&
    !allowedRawColorFiles.has(displayPath)
  ) {
    violations.push(`${displayPath}: hardcoded presentation color`);
  }
}

if (violations.length > 0) {
  console.error(`Theme contract violations:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  process.exit(1);
}

console.log('Theme contract audit passed.');
