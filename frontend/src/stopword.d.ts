declare module 'stopword' {
  /** Array-valued language exports loaded on demand by `loadMergedStopwords`. */
  const stopwordExports: Record<string, unknown>;
  export = stopwordExports;
}
