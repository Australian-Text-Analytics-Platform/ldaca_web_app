// @vitest-environment node

import { describe, expect, it } from 'vitest';
import viteConfig from '../../../vite.config';

describe('vite config', () => {
  it('defines the src alias explicitly', () => {
    const config = viteConfig as { resolve?: { alias?: Record<string, string> } };

    expect(config.resolve?.alias?.['@']).toBeTruthy();
  });

  it('uses esbuild CSS minification for Tailwind compatibility on Vite 8', () => {
    const config = viteConfig as { build?: { cssMinify?: string } };

    expect(config.build?.cssMinify).toBe('esbuild');
  });

  it('uses the default Vite dependency cache location', () => {
    const config = viteConfig as { cacheDir?: string };

    expect(config.cacheDir).toBeUndefined();
  });

  it('lets Vite handle build chunking automatically', () => {
    const config = viteConfig as {
      build?: {
        rollupOptions?: { output?: { manualChunks?: unknown } };
      };
    };

    expect(config.build?.rollupOptions?.output?.manualChunks).toBeUndefined();
  });

  it('forwards browser warnings and errors to the dev server console', () => {
    const config = viteConfig as {
      server?: {
        forwardConsole?: {
          unhandledErrors?: boolean;
          logLevels?: string[];
        };
      };
    };

    expect(config.server?.forwardConsole).toEqual({
      unhandledErrors: true,
      logLevels: ['warn', 'error'],
    });
  });
});