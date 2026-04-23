export type ReferenceTarget = {
  file: string;
  anchor: string;
  label?: string;
};

const registry: Record<string, ReferenceTarget> = {
  'general.platform': {
    file: 'references/general.md',
    anchor: 'ref-general-platform',
    label: 'Cite LDaCA Text Analytics',
  },
};

export const getReferenceTarget = (key: string): ReferenceTarget | null => registry[key] ?? null;

export const referenceIndexTarget: ReferenceTarget = {
  file: 'references/index.md',
  anchor: 'help-references-index',
  label: 'References index',
};
