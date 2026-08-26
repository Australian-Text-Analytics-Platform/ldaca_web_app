import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(resolve(process.cwd(), 'public/theme-bootstrap.js'), 'utf8');

function runBootstrap(stored: string | null | Error) {
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
  let themeColor = '';
  const localStorage = {
    getItem: () => {
      if (stored instanceof Error) throw stored;
      return stored;
    },
  };
  runInNewContext(bootstrap, {
    document: {
      documentElement: root,
      querySelector: () => ({
        setAttribute: (_name: string, value: string) => (themeColor = value),
      }),
    },
    window: { localStorage },
  });
  return { root, themeColor };
}

describe('pre-React theme bootstrap', () => {
  it.each([null, 'system', new Error('storage blocked')])(
    'falls back to Light 2026 for %s',
    (stored) => {
      const result = runBootstrap(stored);
      expect(result.root.dataset.theme).toBe('light-2026');
      expect(result.root.style.colorScheme).toBe('light');
      expect(result.themeColor).toBe('#FAFAFD');
    },
  );

  it('applies a valid last-known dark theme before React starts', () => {
    const result = runBootstrap('dark-2026');
    expect(result.root.dataset.theme).toBe('dark-2026');
    expect(result.root.style.colorScheme).toBe('dark');
    expect(result.themeColor).toBe('#191A1B');
  });
});
