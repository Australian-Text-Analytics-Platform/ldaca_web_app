import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSqlDataBlock: vi.fn(),
  polarsExpressionApply: vi.fn(),
  setInputSet: vi.fn(),
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

vi.mock('@/features/views/common/nodeInputs', async (importOriginal) => ({
  ...(await importOriginal()),
  useTabNodeInputs: ({ selectorId }: { selectorId: string }) => {
    const sourceSelected = selectorId === 'source';
    return {
      inputs: sourceSelected ? [{ node_id: 'source-1', column: 'text' }] : [],
      resolvedNodes: sourceSelected
        ? [
            {
              id: 'source-1',
              name: 'Source',
              column: 'text',
              columnOptions: [{ name: 'text' }],
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
      setColumn: vi.fn(),
    };
  },
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  NodeInputsPanel: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('@/features/views/common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => (
    <div>
      {children}
      {footer}
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
    lastFetchedRef: { current: null },
    taskStatus: { tasks: [] },
    banner: null,
    clearResults: vi.fn(),
    stopTask: vi.fn(),
  }),
}));

vi.mock('../hooks/useAnnotationAiPreviewSession', () => ({
  useAnnotationAiPreviewSession: () => ({
    commands: {
      open: vi.fn(),
      close: vi.fn(),
      canToggle: true,
    },
  }),
}));

import AnnotationFeature from '../AnnotationFeature';

describe('AnnotationFeature', () => {
  beforeEach(() => {
    mocks.createSqlDataBlock.mockReset();
    mocks.polarsExpressionApply.mockReset();
    mocks.setInputSet.mockReset();
    mocks.createSqlDataBlock.mockResolvedValue({ id: 'class-node-1' });
    mocks.polarsExpressionApply.mockResolvedValue(undefined);
  });

  it('creates and selects an empty class Data Block from the explicit action', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          taskId: null,
          inputSets: {},
          settings: {},
          setTaskId: vi.fn(),
          setInputSet: mocks.setInputSet,
          setSetting: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create empty class Data Block' }));

    expect(mocks.createSqlDataBlock).toHaveBeenCalledWith(
      ['source-1'],
      'SELECT CAST("text" AS VARCHAR) AS "class", CAST("text" AS VARCHAR) AS "description" FROM "source-1" LIMIT 0',
      'Source_annotation_classes',
    );
    expect(mocks.setInputSet).toHaveBeenCalledWith('classDescriptions', [
      { node_id: 'class-node-1', column: 'class' },
    ]);
  });

  it('starts manual annotation through the typed expression contract', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          taskId: null,
          inputSets: {},
          settings: {},
          setTaskId: vi.fn(),
          setInputSet: mocks.setInputSet,
          setSetting: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start' }));

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
  });
});
