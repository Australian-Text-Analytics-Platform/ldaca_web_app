export type ReferenceTarget = {
  file: string;
  anchor: string;
  label?: string;
};

const registry = {
  'general.platform': {
    file: 'references/general.md',
    anchor: 'ref-general-platform',
    label: 'Cite LDaCA Text Analytics',
  },
} as const satisfies Record<string, ReferenceTarget>;

export type ReferenceTargetKey = keyof typeof registry;

export const getReferenceTarget = (key: string): ReferenceTarget | null =>
  (registry as Record<string, ReferenceTarget>)[key] ?? null;

export const referenceIndexTarget: ReferenceTarget = {
  file: 'references/index.md',
  anchor: 'help-references-index',
  label: 'References index',
};
