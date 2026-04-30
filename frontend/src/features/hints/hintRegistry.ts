import type { HintDefinition } from './types';

/**
 * Ordered registry of contextual hints. To add a new hint:
 *
 * 1. (If needed) add a new id to `HintConditionId` in `types.ts` and
 *    implement it in `conditions.ts`.
 * 2. (If needed) add `data-hint-id="..."` to the anchor element in the UI.
 * 3. Append a `HintDefinition` here.
 *
 * Hints are evaluated top-to-bottom and the first one whose condition is
 * `true`, whose anchor resolves to a visible element, and which the user
 * has not dismissed is shown. Use `priority` to override pure registry order.
 */
export const hintRegistry: HintDefinition[] = [
  {
    id: 'workspace.upload-needs-workspace',
    title: 'Create a workspace before adding this file',
    body:
      'You\u2019ve uploaded a file, but it cannot be added to any workspace until one is active. Create a new workspace or pick an existing one from the list.',
    condition: 'file-uploaded-no-workspace',
    anchorHintId: 'workspace.create-or-load',
    priority: 5,
    oneShot: false,
    placement: 'bottom',
  },
  {
    id: 'workspace.create-or-load',
    title: 'Start by creating or loading a workspace',
    body:
      'Most actions are disabled until a workspace is active. Create a new one here, or pick an existing workspace from the list before uploading or analysing data.',
    condition: 'no-active-workspace',
    anchorHintId: 'workspace.create-or-load',
    priority: 10,
    oneShot: false,
    placement: 'bottom',
    learnMoreTarget: 'data-loader.create-workspace.button',
  },
  {
    id: 'data-loader.add-file-row',
    title: 'Add this file to your workspace',
    body:
      'Uploading a file does not load it automatically. Click "Add" on the file row to bring it into the active workspace as a data block.',
    condition: 'file-uploaded-not-added',
    priority: 20,
    oneShot: false,
    placement: 'left',
    learnMoreTarget: 'data-loader.upload.button',
    resolveAnchor: ({ lastUploadedFilePath }) => {
      if (!lastUploadedFilePath) return null;
      const row = document.querySelector(
        `[data-testid="file-row-${CSS.escape(lastUploadedFilePath)}"]`,
      );
      if (!row) return null;
      // Highlight the Add button specifically when present.
      const addBtn =
        row.querySelector('[data-hint-id="data-loader.file-row.add"]') ?? null;
      return addBtn ?? row;
    },
  },
  {
    id: 'workspace.empty-upload-data',
    title: 'Your workspace is empty',
    body:
      'Upload a file in the Data Loader and click "Add" to populate your workspace with a data block.',
    condition: 'workspace-has-no-nodes',
    anchorHintId: 'sidebar.data-loader',
    priority: 30,
    oneShot: false,
    placement: 'right',
  },
];
