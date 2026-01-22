export type TutorialTarget = {
  file: string;
  anchor: string;
  label?: string;
};

const registry: Record<string, TutorialTarget> = {
  'data-loader.active-workspace.section': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-active-workspace',
    label: 'Active workspace overview',
  },
  'data-loader.create-workspace.name': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-create-workspace-name',
    label: 'Workspace name input',
  },
  'data-loader.create-workspace.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-create-workspace-button',
    label: 'Create workspace button',
  },
  'data-loader.rename-workspace.input': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-rename-workspace-input',
    label: 'Rename workspace input',
  },
  'data-loader.save-as.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-save-as-button',
    label: 'Save workspace as',
  },
  'data-loader.unload.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-unload-button',
    label: 'Unload workspace',
  },
  'data-loader.files.section': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-files-section',
    label: 'Files and uploads section',
  },
  'data-loader.upload.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-upload-button',
    label: 'Upload file',
  },
  'data-loader.import-sample.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-import-sample-button',
    label: 'Import sample data',
  },
  'data-loader.add.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-add-button',
    label: 'Add file to workspace',
  },
  'preprocessing.join.tab': {
    file: 'tutorials/preprocessing-join.md',
    anchor: 'help-preprocessing-join-section',
    label: 'Join sub-tab overview',
  },
  'preprocessing.join.column': {
    file: 'tutorials/preprocessing-join.md',
    anchor: 'help-preprocessing-join-column-picker',
    label: 'Join column picker',
  },
  'preprocessing.join.join-type': {
    file: 'tutorials/preprocessing-join.md',
    anchor: 'help-preprocessing-join-type',
    label: 'Join type selector',
  },
  'preprocessing.join.new-node-name': {
    file: 'tutorials/preprocessing-join.md',
    anchor: 'help-preprocessing-join-node-name',
    label: 'Join output name',
  },
  'preprocessing.join.apply-button': {
    file: 'tutorials/preprocessing-join.md',
    anchor: 'help-preprocessing-join-apply',
    label: 'Apply join',
  },
  'analysis.token-frequency.stop-words': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-stop-words',
    label: 'Stop words input',
  },
  'analysis.token-frequency.run': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-run',
    label: 'Run token frequency',
  },
  'analysis.concordance.search-term': {
    file: 'tutorials/concordance.md',
    anchor: 'help-concordance-search-term',
    label: 'Concordance search term',
  },
  'analysis.concordance.regex-toggle': {
    file: 'tutorials/concordance.md',
    anchor: 'help-concordance-regex-toggle',
    label: 'Regex mode toggle',
  },
  'analysis.topic-modeling.min-topic-size': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-min-topic-size',
    label: 'Minimum topic size',
  },
  'analysis.topic-modeling.ctfidf-toggle': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-ctfidf-toggle',
    label: 'c-TF-IDF toggle',
  },
  'analysis.sequential-analysis.time-column': {
    file: 'tutorials/sequential-analysis.md',
    anchor: 'help-sequential-time-column',
    label: 'Time column selector',
  },
  'analysis.sequential-analysis.frequency': {
    file: 'tutorials/sequential-analysis.md',
    anchor: 'help-sequential-frequency',
    label: 'Frequency selector',
  },
  'analysis.quotation.context-length': {
    file: 'tutorials/quotation.md',
    anchor: 'help-quotation-context-length',
    label: 'Quotation context length',
  },
  'analysis.export.format': {
    file: 'tutorials/export.md',
    anchor: 'help-export-format',
    label: 'Export format selector',
  },
  'analysis.export.run': {
    file: 'tutorials/export.md',
    anchor: 'help-export-run',
    label: 'Export action',
  },
};

export const getTutorialTarget = (key: string): TutorialTarget | null => registry[key] ?? null;

export const tutorialIndexTarget: TutorialTarget = {
  file: 'tutorials/index.md',
  anchor: 'help-tutorial-index',
  label: 'Tutorial index',
};
