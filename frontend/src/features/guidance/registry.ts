import type { ContextualHintDefinition, GuidedTourDefinition } from './types';

export const DATA_LOADER_GUIDANCE_IDS = {
  workspace: 'data-loader.workspace',
  workspaceLoad: 'data-loader.workspace-load',
  fileSources: 'data-loader.file-sources',
  addDataBlock: 'data-loader.add-data-block',
  dataBlocks: 'data-loader.data-blocks',
} as const;

const resolveAddDataBlockTarget = () =>
  document.querySelector<HTMLElement>('[data-guidance="add-data-block"]:not(:disabled)') ??
  document.querySelector<HTMLElement>('[data-guidance="file-library-toolbar"]');

/** First-run Data Loader guidance, ordered by the workflow state that requests it. */
export const contextualHintRegistry: readonly ContextualHintDefinition[] = [
  {
    id: DATA_LOADER_GUIDANCE_IDS.workspace,
    version: 1,
    target: '[data-guidance="workspace-setup"]',
    title: 'Start with a workspace',
    content:
      'A workspace is the project container that keeps your Data Blocks and analysis history together. Create one here, or load an existing workspace from the manager.',
  },
  {
    id: DATA_LOADER_GUIDANCE_IDS.workspaceLoad,
    version: 1,
    target: '[data-guidance="workspace-manager"]',
    title: 'Load a workspace',
    content:
      'Workspaces you create or upload stay in this list. Choose Load beside a workspace to make it active. Data Blocks and analyses belong to the active workspace.',
  },
  {
    id: DATA_LOADER_GUIDANCE_IDS.fileSources,
    version: 1,
    target: '[data-guidance="file-sources"]',
    title: 'Choose your starting data',
    content:
      'Your file library is empty. Import sample data for a ready-to-use example, or upload files of your own. These files remain source material until you add one to a workspace.',
  },
  {
    id: DATA_LOADER_GUIDANCE_IDS.addDataBlock,
    version: 1,
    target: resolveAddDataBlockTarget,
    placement: 'auto',
    title: 'Turn a file into a Data Block',
    content:
      'A Data Block is an analysis-ready item inside the active workspace. Preview a file if you want to inspect it, then choose Add beside that file.',
  },
  {
    id: DATA_LOADER_GUIDANCE_IDS.dataBlocks,
    version: 1,
    target: '[data-guidance="data-blocks"]',
    title: 'Your first Data Block',
    content:
      'Data Blocks appear here and in the workspace graph. Select one to inspect its data, then choose an analysis view such as Preprocessing or Frequency.',
  },
];

/** This release intentionally ships the framework without production tours. */
export const guidedTourRegistry: readonly GuidedTourDefinition[] = [];
