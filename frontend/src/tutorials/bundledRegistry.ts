/**
 * Bundled fallback registry. Ships inside the app bundle and is used:
 *  - when `VITE_DOCS_BASE_URL` is unset (offline-only build),
 *  - while the remote `registry.json` fetch is in flight on first paint,
 *  - if the remote fetch fails and no cache is present.
 *
 * The runtime merges remote-over-bundled, so anything in the bundle here is
 * shadowed once the remote registry arrives. To drop an entry from the
 * bundle, delete it here — the remote registry continues to serve it.
 *
 * Today this file mirrors the previously-inline registries 1:1 so nothing
 * breaks before the docs site is live. Once the remote registry is
 * deployed and reliable, trim this down to the minimal offline set
 * (see `docs/refactoring/online-tutorial-migration.md` §3.10B).
 */

export type DocTarget = {
  file: string;
  anchor: string;
  label?: string;
};

export type DocLinkKind = 'tutorial' | 'info' | 'reference';

export type RegistryShape = {
  tutorial: Record<string, DocTarget>;
  info: Record<string, DocTarget>;
  reference: Record<string, DocTarget>;
  /**
   * Optional registry metadata. Set on the remote payload only — bundled
   * fallback never carries an EOL date.
   */
  meta?: {
    version?: string;
    /** Date (ISO-8601) when this docs version is no longer supported. */
    eolDate?: string;
  };
};

const tutorial = {
  'ui.tool-choice': {
    file: 'tutorials/ui.md',
    anchor: 'help-ui-tool-choice',
    label: 'Tool Choice',
  },
  'ui.data-selection': {
    file: 'tutorials/ui.md',
    anchor: 'help-ui-data-selection',
    label: 'Data Selection',
  },
  'ui.task-centre': {
    file: 'tutorials/ui.md',
    anchor: 'help-ui-task-centre',
    label: 'Task Centre',
  },
  'ui.workspace-graph-view': {
    file: 'tutorials/ui.md',
    anchor: 'help-ui-workspace-graph-view',
    label: 'Workspace Graph View',
  },
  'ui.data-viewer': {
    file: 'tutorials/ui.md',
    anchor: 'help-ui-data-viewer',
    label: 'Data Viewer',
  },
  'ui.working-directory': {
    file: 'tutorials/ui.md',
    anchor: 'help-ui-working-directory',
    label: 'Working Directory',
  },
  'ui.help-feedback': {
    file: 'tutorials/ui.md',
    anchor: 'help-ui-help-feedback',
    label: 'Help and Feedback',
  },
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
    label: 'Upload files',
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
    label: 'Sample sub-tab overview',
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
    label: 'Sample output name',
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
  'preprocessing.concat.deduplicate': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-concat-deduplicate',
    label: 'Deduplicate stacked rows',
  },
  'preprocessing.concat.schema-status': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-concat-schema-status',
    label: 'Column compatibility',
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
  'preprocessing.find.tab': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-find-replace',
    label: 'Find sub-tab overview',
  },
  'preprocessing.expression.tab': {
    file: 'tutorials/preprocessing.md',
    anchor: 'help-preprocessing-expression-section',
    label: 'Polars Expression sub-tab overview',
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
  'analysis.token-frequency.reference': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-reference',
    label: 'Study Data Block',
  },
  'analysis.token-frequency.token-limit': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-token-limit',
    label: 'Cloud display limit',
  },
  'analysis.token-frequency.list-limit': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-list-limit',
    label: 'List display limit',
  },
  'analysis.token-frequency.token-filter': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-token-filter',
    label: 'Filter tokens',
  },
  'analysis.token-frequency.unified-word-cloud': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-unified-word-cloud',
    label: 'Juxtorpus',
  },
  'analysis.token-frequency.statistical-measures': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-statistical-measures',
    label: 'Statistical measures',
  },
  'analysis.token-frequency.stop-words': {
    file: 'tutorials/token-frequency.md',
    anchor: 'help-token-frequency-stop-words',
    label: 'Stop words',
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
  'analysis.concordance.search-mode': {
    file: 'tutorials/concordance.md',
    anchor: 'help-concordance-search-mode',
    label: 'Search mode (text vs tokens)',
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
  'analysis.topic-modeling.sampling': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-sampling',
    label: 'Data block sampling',
  },
  'analysis.topic-modeling.options': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-options',
    label: 'Topic modelling options',
  },
  'analysis.topic-modeling.topic-size-mode': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-topic-size-mode',
    label: 'Topic size mode',
  },
  'analysis.topic-modeling.aim-topic-no': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-aim-topic-no',
    label: 'Aim Topic No.',
  },
  'analysis.topic-modeling.min-topic-size': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-min-topic-size',
    label: 'Min Topic Size',
  },
  'analysis.topic-modeling.exact-topic-no': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-exact-topic-no',
    label: 'Exact Topic No.',
  },
  'analysis.topic-modeling.random-seed': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-random-seed',
    label: 'Random seed',
  },
  'analysis.topic-modeling.words-per-topic': {
    file: 'tutorials/topic-modeling.md',
    anchor: 'help-topic-modeling-words-per-topic',
    label: 'Words per topic',
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
} as const satisfies Record<string, DocTarget>;

const info = {
  'general.overview': {
    file: 'information/general.md',
    anchor: 'info-general-overview',
    label: 'About Wordflow',
  },
  'data-loader.overview': {
    file: 'information/data-loader.md',
    anchor: 'info-data-loader-overview',
    label: 'About the Data Loader',
  },
  'preprocessing.overview': {
    file: 'information/preprocessing.md',
    anchor: 'info-preprocessing-overview',
    label: 'About Data Preprocessing',
  },
  'concordance.overview': {
    file: 'information/concordance.md',
    anchor: 'info-concordance-overview',
    label: 'About Concordance Search',
  },
  'quotation.overview': {
    file: 'information/quotation.md',
    anchor: 'info-quotation-overview',
    label: 'About Quotation Extraction',
  },
  'sequential-analysis.overview': {
    file: 'information/sequential-analysis.md',
    anchor: 'info-sequential-analysis-overview',
    label: 'About Sequential Analysis',
  },
  'token-frequency.overview': {
    file: 'information/token-frequency.md',
    anchor: 'info-token-frequency-overview',
    label: 'About Token Frequency Analysis',
  },
  'topic-modeling.overview': {
    file: 'information/topic-modeling.md',
    anchor: 'info-topic-modeling-overview',
    label: 'About Topic Modeling',
  },
  'export.overview': {
    file: 'information/export.md',
    anchor: 'info-export-overview',
    label: 'About Exporting Data',
  },
  'ai-annotator.overview': {
    file: 'information/ai-annotator.md',
    anchor: 'info-ai-annotator-overview',
    label: 'About AI Annotation and Review',
  },
} as const satisfies Record<string, DocTarget>;

const reference = {
  'general.platform': {
    file: 'references/general.md',
    anchor: 'ref-general-platform',
    label: 'Cite LDaCA Wordflow',
  },
  'analysis.token-frequency.keyness-statistics': {
    file: 'references/keyness-statistics.md',
    anchor: 'ref-token-frequency-keyness-statistics',
    label: 'Keyword Analysis — method & citations',
  },
} as const satisfies Record<string, DocTarget>;

export const BUNDLED_REGISTRY: RegistryShape = { tutorial, info, reference };

export type BundledTutorialKey = keyof typeof tutorial;
export type BundledInfoKey = keyof typeof info;
export type BundledReferenceKey = keyof typeof reference;

export const TUTORIAL_INDEX_TARGET: DocTarget = {
  file: 'tutorials/index.md',
  anchor: 'help-tutorial-index',
  label: 'Tutorial index',
};

export const INFO_INDEX_TARGET: DocTarget = {
  file: 'information/index.md',
  anchor: 'help-information-index',
  label: 'Information index',
};

export const REFERENCE_INDEX_TARGET: DocTarget = {
  file: 'references/index.md',
  anchor: 'help-references-index',
  label: 'References index',
};

/** Files that ship inside `frontend/public/`. The remote-URL resolver in
 *  `DocumentView` falls back to the local-relative path for these even when
 *  `VITE_DOCS_BASE_URL` is set, so first-paint remains zero-network. */
export const BUNDLED_FILES: ReadonlySet<string> = new Set(
  [
    ...Object.values(tutorial),
    ...Object.values(info),
    ...Object.values(reference),
    // The index entry points are standalone *_INDEX_TARGET constants (not
    // members of the keyed objects above), yet they ship in public/ too.
    // Without them the main Tutorial button and the info/reference index
    // links resolve against VITE_DOCS_BASE_URL — a remote fetch a Tauri
    // build's CSP blocks, surfacing as "load fail". Bundle them so they
    // load locally in the desktop app exactly like the web host.
    TUTORIAL_INDEX_TARGET,
    INFO_INDEX_TARGET,
    REFERENCE_INDEX_TARGET,
  ].map((t) => t.file),
);
