declare module '@rolldown/plugin-babel' {
  import type { Plugin } from 'vite';

  /** Rolldown Babel plugin factory used by Vite config until upstream types ship. */
  const babel: (options: Record<string, unknown>) => Promise<Plugin>;
  export default babel;
}
