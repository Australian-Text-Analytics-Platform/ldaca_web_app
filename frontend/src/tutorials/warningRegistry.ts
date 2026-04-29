export type WarningTarget = {
  file: string;
  anchor: string;
  label?: string;
};

const registry: Record<string, WarningTarget> = {
  // Add warning entries here following the pattern:
  // 'domain.feature.item': {
  //   file: 'warnings/some-file.md',
  //   anchor: 'warn-some-anchor',
  //   label: 'Human-readable label',
  // },
};

export const getWarningTarget = (key: string): WarningTarget | null => registry[key] ?? null;

export const warningIndexTarget: WarningTarget = {
  file: 'warnings/index.md',
  anchor: 'help-warnings-index',
  label: 'Warnings index',
};
