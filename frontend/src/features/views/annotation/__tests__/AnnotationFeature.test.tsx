import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSqlDataBlock: vi.fn(),
  polarsExpressionApply: vi.fn(),
  setInputSet: vi.fn(),
  setSetting: vi.fn(),
  invalidateQueries: vi.fn(),
  clearResults: vi.fn(),
  persistDocumentColumn: vi.fn(),
  setSourceColumn: vi.fn(),
  setExampleColumn: vi.fn(),
  exampleSelected: false,
  sourceColumnNames: ['text'] as string[],
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({ currentWorkspaceId: 'workspace-1' }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    createSqlDataBlock: mocks.createSqlDataBlock,
    polarsExpressionApply: mocks.polarsExpressionApply,
  }),
}));

vi.mock('@/features/views/common/hooks/usePersistNodeDocumentColumn', () => ({
  usePersistNodeDocumentColumn: () => mocks.persistDocumentColumn,
}));

vi.mock('@/features/views/common/nodeInputs', async (importOriginal) => ({
  ...(await importOriginal()),
  useTabNodeInputs: ({ selectorId }: { selectorId: string }) => {
    const sourceSelected = selectorId === 'source';
    const exampleSelected = selectorId === 'exampleNodes' && mocks.exampleSelected;
    const selected = sourceSelected || exampleSelected;
    const nodeId = sourceSelected ? 'source-1' : 'example-1';
    return {
      inputs: selected ? [{ node_id: nodeId, column: 'text' }] : [],
      resolvedNodes: selected
        ? [
            {
              id: nodeId,
              name: sourceSelected ? 'Source' : 'Example',
              column: 'text',
              node: { shape: [2380, 21] },
              columnOptions: mocks.sourceColumnNames.map((name) => ({ name })),
            },
          ]
        : [],
      availableNodes: [],
      graphSelectedIds: [],
      recentPresets: [],
      canAddMore: !sourceSelected,
      addNodes: vi.fn(),
      getAddRejection: vi.fn(() => null),
      removeNode: vi.fn(),
      clear: vi.fn(),
      setColumn: sourceSelected
        ? mocks.setSourceColumn
        : exampleSelected
          ? mocks.setExampleColumn
          : vi.fn(),
    };
  },
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  NodeInputsPanel: ({
    title,
    resolvedNodes,
    renderColumnAddon,
    onColumnChange,
  }: {
    title: string;
    resolvedNodes: {
      id: string;
      name: string;
      column: string;
      columnOptions: { name: string }[];
    }[];
    renderColumnAddon?: (args: {
      node: { id: string; name: string };
      nodeId: string;
      index: number;
      color: string;
      column: string;
      columns: string[];
    }) => ReactNode;
    onColumnChange: (nodeId: string, column: string) => void;
  }) => (
    <div>
      {title}
      {resolvedNodes.map((resolved, index) => (
        <div key={resolved.id}>
          <button type="button" onClick={() => onColumnChange(resolved.id, 'body')}>
            Change {title} text column
          </button>
          {renderColumnAddon?.({
            node: { id: resolved.id, name: resolved.name },
            nodeId: resolved.id,
            index,
            color: '#000000',
            column: resolved.column,
            columns: resolved.columnOptions.map((option) => option.name),
          })}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/features/views/common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({
    children,
    footer,
    actions,
  }: {
    children: ReactNode;
    footer?: ReactNode;
    actions?: { onClear: () => void | Promise<void> };
  }) => (
    <div>
      {children}
      {footer}
      {actions ? (
        <button
          type="button"
          onClick={() => {
            void actions.onClear();
          }}
        >
          Clear Results
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../components/AnnotationClassDescriptionsEditor', () => ({
  AnnotationClassDescriptionsEditor: () => null,
}));

vi.mock('../components/AnnotationResultsPanel', () => ({
  AnnotationResultsPanel: () => null,
}));

vi.mock('../hooks/useAnnotationClassDescriptions', () => ({
  useAnnotationClassDescriptions: () => ({ rows: [], query: {} }),
}));

vi.mock('@/features/provider-credentials/useProviderCredentials', () => ({
  useProviderCredentials: () => ({ annotationProviders: [], revision: 0 }),
}));

vi.mock('../../common/hooks/useAnalysisFeature', () => ({
  useAnalysisFeature: () => ({
    request: null,
    result: null,
    isRunning: false,
    isStopping: false,
    setIsRunning: vi.fn(),
    setLocalTaskId: vi.fn(),
    runningRef: { current: false },
    taskStatus: { tasks: [] },
    banner: null,
    clearResults: mocks.clearResults,
    stopTask: vi.fn(),
  }),
}));

vi.mock('../hooks/useAnnotationAiPreview', () => ({
  useAnnotationAiPreview: () => ({}),
}));

import AnnotationFeature from '../AnnotationFeature';

describe('AnnotationFeature', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.createSqlDataBlock.mockReset();
    mocks.polarsExpressionApply.mockReset();
    mocks.setInputSet.mockReset();
    mocks.setSetting.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.clearResults.mockReset();
    mocks.persistDocumentColumn.mockReset();
    mocks.setSourceColumn.mockReset();
    mocks.setExampleColumn.mockReset();
    mocks.exampleSelected = false;
    mocks.sourceColumnNames = ['text'];
    mocks.createSqlDataBlock.mockResolvedValue({ id: 'class-node-1' });
    mocks.polarsExpressionApply.mockResolvedValue(undefined);
    mocks.clearResults.mockResolvedValue(undefined);
  });

  it('persists manual text-column choices for source and example Data Blocks', async () => {
    const user = userEvent.setup();
    mocks.exampleSelected = true;

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: { annotationMode: 'ai' },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Change Selected Data Blocks text column' }),
    );
    expect(screen.getByText('Example Data Block')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Change Example Node text column' }));

    expect(mocks.setSourceColumn).toHaveBeenCalledWith('source-1', 'body');
    expect(mocks.setExampleColumn).toHaveBeenCalledWith('example-1', 'body');
    expect(mocks.persistDocumentColumn.mock.calls).toEqual([
      ['source-1', 'body'],
      ['example-1', 'body'],
    ]);
  });

  it('creates and selects an empty class Data Block from the explicit action', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {},
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: vi.fn(),
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    expect(screen.getByTestId('annotation-node-selector-grid')).toHaveClass(
      '@min-[640px]/annotation-selectors:grid-cols-2',
    );
    expect(screen.getByRole('heading', { name: 'Annotation Data Block', level: 3 })).toHaveClass(
      'mb-3',
    );
    expect(
      screen.getByRole('heading', { name: 'Class Descriptions', level: 3 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create New' }));

    expect(mocks.createSqlDataBlock).toHaveBeenCalledWith(
      ['source-1'],
      'SELECT CAST("text" AS VARCHAR) AS "class", CAST("text" AS VARCHAR) AS "description" FROM "source-1" LIMIT 0',
      'Source_annotation_classes',
    );
    expect(mocks.setInputSet).toHaveBeenCalledWith('classDescriptions', [
      { node_id: 'class-node-1', column: 'class' },
    ]);
  });

  it('creates and selects a new annotation column from the picker dialog', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'text' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(screen.getByRole('option', { name: 'Start new annotation' }));

    expect(screen.getByRole('heading', { name: 'Create annotation column' })).toBeInTheDocument();
    const columnName = screen.getByRole('textbox', { name: 'Column name' });
    expect(columnName).toHaveValue('');
    expect(columnName).toHaveAttribute('placeholder', 'annotation');
    await user.click(columnName);
    await user.tab();
    expect(columnName).toHaveValue('annotation');
    expect(columnName).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mocks.polarsExpressionApply).toHaveBeenCalledWith(
      'source-1',
      {
        context: 'with_columns',
        expressions: [
          {
            expression: {
              op: 'cast',
              operand: { op: 'literal', value: null },
              dtype: 'string',
              strict: false,
            },
            alias: 'annotation',
          },
        ],
        group_by: [],
        name: null,
      },
      'update',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Annotation Column' })).toHaveTextContent(
      'annotation',
    );
    expect(screen.queryByLabelText('New Column Name')).not.toBeInTheDocument();
    expect(mocks.setSetting).toHaveBeenCalledWith(
      'annotationTargets',
      JSON.stringify({ 'source-1': 'annotation' }),
    );
  });

  it('labels the active manual review action Clear', async () => {
    const user = userEvent.setup();
    mocks.sourceColumnNames = ['text', 'annotation'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('keeps the dialog open rather than overwriting an existing column', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'text' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(screen.getByRole('option', { name: 'Start new annotation' }));
    await user.type(screen.getByRole('textbox', { name: 'Column name' }), 'text');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByRole('alert')).toHaveTextContent('A column named "text" already exists.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.polarsExpressionApply).not.toHaveBeenCalled();
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it('owns correction-column creation and example reuse in the parameter panel', async () => {
    const user = userEvent.setup();
    const setCorrectionColumn = vi.fn();
    mocks.sourceColumnNames = ['text', 'annotation', 'review'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationMode: 'ai',
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: { 'source-1': 'review' },
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn,
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    const correctionColumn = screen.getByRole('combobox', { name: 'User Correction Column' });
    const exampleDataBlock = screen.getByText('Example Data Block');
    expect(correctionColumn).toHaveTextContent('review');
    expect(
      correctionColumn.compareDocumentPosition(exampleDataBlock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getByText('Example Node')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Use the correction column as the example' }),
    );
    expect(mocks.setInputSet).toHaveBeenCalledWith('exampleNodes', [
      { node_id: 'source-1', column: 'text' },
    ]);

    await user.click(screen.getByRole('combobox', { name: 'User Correction Column' }));
    await user.click(screen.getByRole('option', { name: 'Add new column' }));
    const columnName = screen.getByRole('textbox', { name: 'Correction column name' });
    expect(columnName).toHaveAttribute('placeholder', 'annotation.correction');
    await user.click(columnName);
    await user.tab();
    expect(columnName).toHaveValue('annotation.correction');
    expect(columnName).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(setCorrectionColumn).toHaveBeenCalledWith('source-1', 'annotation.correction');
    });
    expect(mocks.polarsExpressionApply).toHaveBeenCalledWith(
      'source-1',
      expect.objectContaining({
        expressions: [expect.objectContaining({ alias: 'annotation.correction' })],
      }),
      'update',
    );
  });

  it('clears the persisted correction-column draft with the task results', async () => {
    const user = userEvent.setup();
    const clearCorrectionColumns = vi.fn();
    mocks.sourceColumnNames = ['text', 'annotation', 'review'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationMode: 'ai',
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: { 'source-1': 'review' },
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns,
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear Results' }));

    await waitFor(() => {
      expect(mocks.clearResults).toHaveBeenCalledTimes(1);
      expect(clearCorrectionColumns).toHaveBeenCalledTimes(1);
    });
  });
});
