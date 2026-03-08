import { loadESLint } from 'eslint';

const DefaultESLint = await loadESLint();
const eslint = new DefaultESLint();
const results = await eslint.lintFiles([
  'src/hooks/useFilePreview.ts',
  'src/hooks/workspace/useWorkspaceCore.ts',
  'src/hooks/useAutoNodeColumns.ts',
  'src/hooks/useSchemaManagement.ts',
  'src/features/workspace/task-stream/useWorkspaceTaskStreamClient.ts',
  'src/features/workspace/data-view/hooks/useWorkspaceDataTable.ts',
  'src/features/analysis/topic-modeling/hooks/useTopicModelingZoomBrush.ts',
  'src/features/analysis/sequential-analysis/SequentialAnalysisFeature.tsx',
  'src/features/preprocessing/hooks/usePreprocessingPreview.ts',
  'src/components/ui/sidebar.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/tag.tsx',
  'src/providers/QueryProvider.tsx',
  'src/providers/WorkspaceProvider.tsx',
  'src/App.tsx',
  'src/components/CustomNode.tsx',
  'src/components/AnalysisPagination.tsx',
  'src/features/workspace/data-view/components/TablePaginationControls.tsx',
]);
let total = 0;
for (const r of results) {
  for (const m of r.messages) {
    const fname = r.filePath.split('/').pop();
    const sev = m.severity === 2 ? 'error' : 'warning';
    console.log(`${fname}:${m.line} ${sev} [${m.ruleId}] ${m.message.substring(0,120)}`);
    total++;
  }
}
console.log(`\nTotal: ${total} problems`);
