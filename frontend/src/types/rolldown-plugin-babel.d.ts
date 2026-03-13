declare module '@rolldown/plugin-babel' {
  import type { Plugin } from 'vite';

  const babel: (options: Record<string, unknown>) => Promise<Plugin>;
  export default babel;
}
