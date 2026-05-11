export type InfoTarget = {
  file: string;
  anchor: string;
  label?: string;
};

const registry = {
  'general.overview': {
    file: 'information/general.md',
    anchor: 'info-general-overview',
    label: 'About LDaCA Text Analytics',
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
} as const satisfies Record<string, InfoTarget>;

export type InfoTargetKey = keyof typeof registry;

export const getInfoTarget = (key: string): InfoTarget | null =>
  (registry as Record<string, InfoTarget>)[key] ?? null;

export const infoIndexTarget: InfoTarget = {
  file: 'information/index.md',
  anchor: 'help-information-index',
  label: 'Information index',
};
