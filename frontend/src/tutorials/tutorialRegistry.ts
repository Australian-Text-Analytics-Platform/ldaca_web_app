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
  'data-loader.tab': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-section',
    label: 'Data loader overview',
  },
  'data-loader.workspace-manager.section': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-workspace-manager',
    label: 'Workspace manager overview',
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
  'data-loader.import-ldaca.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-import-ldaca-button',
    label: 'Import from LDaCA',
  },
  'data-loader.add.button': {
    file: 'tutorials/data-loader.md',
    anchor: 'help-data-loader-add-button',
    label: 'Add file to workspace',
  },
  'preprocessing.join.tab': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-join-section',
    label: 'Join sub-tab overview',
  },
  'preprocessing.join.column': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-join-column-picker',
    label: 'Join column picker',
  },
  'preprocessing.join.join-type': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-join-type',
    label: 'Join type selector',
  },
  'preprocessing.join.new-node-name': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-join-node-name',
    label: 'Join output name',
  },
  'preprocessing.common.node-selection': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-common-node-selection',
    label: 'Data block selection',
  },
  'preprocessing.common.apply-button': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-common-apply-button',
    label: 'Apply action',
  },
  'preprocessing.common.preview': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-common-preview',
    label: 'Preview table',
  },
  'preprocessing.filter.tab': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-filter-section',
    label: 'Filter sub-tab overview',
  },
  'preprocessing.filter.conditions': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-filter-conditions',
    label: 'Filter conditions',
  },
  'preprocessing.filter.new-node-name': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-filter-new-node-name',
    label: 'Filter output name',
  },
  'preprocessing.slice.tab': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-slice-section',
    label: 'Slice sub-tab overview',
  },
  'preprocessing.slice.offset': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-slice-offset',
    label: 'Slice offset',
  },
  'preprocessing.slice.length': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-slice-length',
    label: 'Slice length',
  },
  'preprocessing.slice.new-node-name': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-slice-new-node-name',
    label: 'Slice output name',
  },
  'preprocessing.concat.tab': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-concat-section',
    label: 'Stack sub-tab overview',
  },
  'preprocessing.concat.new-node-name': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-concat-new-node-name',
    label: 'Stack output name',
  },
  'preprocessing.concat.schema-status': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-concat-schema-status',
    label: 'Schema status',
  },
  'preprocessing.aggregate.tab': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-aggregate-section',
    label: 'Create sub-tab overview',
  },
  'preprocessing.aggregate.builder': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-aggregate-builder',
    label: 'Expression builder',
  },
  'preprocessing.aggregate.expression': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-aggregate-expression',
    label: 'Advanced expression',
  },
  'preprocessing.aggregate.column-name': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-aggregate-column-name',
    label: 'Computed column name',
  },
  'analysis.token-frequency.tab': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-section',
    label: 'Token frequency overview',
  },
  'analysis.token-frequency.parameters': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-parameters',
    label: 'Token frequency parameters',
  },
  'analysis.token-frequency.results': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-results',
    label: 'Token frequency results',
  },
  'analysis.token-frequency.clear-results': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-clear-results',
    label: 'Clear results',
  },
  'analysis.token-frequency.unified-word-cloud': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-unified-word-cloud',
    label: 'Unified word cloud',
  },
  'analysis.token-frequency.statistical-measures': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-statistical-measures',
    label: 'Statistical measures',
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
  'analysis.concordance.tab': {
    file: 'tutorials/concordance.md',
    anchor: 'help-concordance-section',
    label: 'Concordance overview',
  },
  'analysis.concordance.parameters': {
    file: 'tutorials/concordance.md',
    anchor: 'help-concordance-parameters',
    label: 'Concordance parameters',
  },
  'analysis.concordance.results': {
    file: 'tutorials/concordance.md',
    anchor: 'help-concordance-results',
    label: 'Concordance results',
  },
  'analysis.concordance.clear-results': {
    file: 'tutorials/concordance.md',
    anchor: 'help-concordance-clear-results',
    label: 'Clear results',
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
  'analysis.topic-modeling.tab': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-section',
    label: 'Topic modeling overview',
  },
  'analysis.topic-modeling.parameters': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-parameters',
    label: 'Topic modeling parameters',
  },
  'analysis.topic-modeling.clear-results': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-clear-results',
    label: 'Clear results',
  },
  'analysis.topic-modeling.results': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-results',
    label: 'Topic modeling results',
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
  'analysis.sequential-analysis.tab': {
    file: 'tutorials/sequential-analysis.md',
    anchor: 'help-sequential-section',
    label: 'Sequential analysis overview',
  },
  'analysis.sequential-analysis.parameters': {
    file: 'tutorials/sequential-analysis.md',
    anchor: 'help-sequential-parameters',
    label: 'Sequential analysis parameters',
  },
  'analysis.sequential-analysis.results': {
    file: 'tutorials/sequential-analysis.md',
    anchor: 'help-sequential-results',
    label: 'Sequential analysis results',
  },
  'analysis.sequential-analysis.clear-results': {
    file: 'tutorials/sequential-analysis.md',
    anchor: 'help-sequential-clear-results',
    label: 'Clear results',
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
  'analysis.quotation.tab': {
    file: 'tutorials/quotation.md',
    anchor: 'help-quotation-section',
    label: 'Quotation extraction overview',
  },
  'analysis.quotation.parameters': {
    file: 'tutorials/quotation.md',
    anchor: 'help-quotation-parameters',
    label: 'Quotation parameters',
  },
  'analysis.quotation.results': {
    file: 'tutorials/quotation.md',
    anchor: 'help-quotation-results',
    label: 'Quotation results',
  },
  'analysis.quotation.clear-results': {
    file: 'tutorials/quotation.md',
    anchor: 'help-quotation-clear-results',
    label: 'Clear results',
  },
  'analysis.quotation.context-length': {
    file: 'tutorials/quotation.md',
    anchor: 'help-quotation-context-length',
    label: 'Quotation context length',
  },
  'analysis.export.tab': {
    file: 'tutorials/export.md',
    anchor: 'help-export-section',
    label: 'Export overview',
  },
  'analysis.export.parameters': {
    file: 'tutorials/export.md',
    anchor: 'help-export-parameters',
    label: 'Export parameters',
  },
  'analysis.export.results': {
    file: 'tutorials/export.md',
    anchor: 'help-export-results',
    label: 'Export results',
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
