// Module-augmentation: extend TanStack Table's `ColumnMeta` so per-column
// header / cell sizing and class hooks declared inline at the column-def
// site type-check.
//
// The trailing `export {}` makes this file a module so the
// `declare module '@tanstack/react-table'` block is treated as an
// augmentation rather than a redeclaration. Once it's a module, tsconfig's
// `include: ["src"]` is enough to apply the augmentation globally — no
// consumer-side `import './tableMeta'` needed.

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    headerClassName?: string;
    headerMinWidth?: number;
    headerMaxWidth?: number;
    cellClassName?: string;
    cellMinWidth?: number;
    cellMaxWidth?: number;
  }
}

export {};
