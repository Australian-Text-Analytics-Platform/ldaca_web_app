export type InfoTarget = {
  file: string;
  anchor: string;
  label?: string;
};

const registry: Record<string, InfoTarget> = {
  // Add information entries here following the pattern:
  // 'domain.feature.item': {
  //   file: 'information/some-file.md',
  //   anchor: 'info-some-anchor',
  //   label: 'Human-readable label',
  // },
};

export const getInfoTarget = (key: string): InfoTarget | null => registry[key] ?? null;

export const infoIndexTarget: InfoTarget = {
  file: 'information/index.md',
  anchor: 'help-information-index',
  label: 'Information index',
};
