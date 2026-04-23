export type ReferenceTarget = {
  file: string;
  anchor: string;
  label?: string;
};

const registry: Record<string, ReferenceTarget> = {
  // Add reference entries here following the pattern:
  // 'domain.feature.item': {
  //   file: 'references/some-file.md',
  //   anchor: 'ref-some-anchor',
  //   label: 'Human-readable label',
  // },
};

export const getReferenceTarget = (key: string): ReferenceTarget | null => registry[key] ?? null;

export const referenceIndexTarget: ReferenceTarget = {
  file: 'references/index.md',
  anchor: 'help-references-index',
  label: 'References index',
};
