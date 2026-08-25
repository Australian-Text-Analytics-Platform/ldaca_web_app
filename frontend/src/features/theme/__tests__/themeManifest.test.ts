import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ThemeManifest {
  source: { version: string; commit: string };
  themes: Record<string, Record<string, string>>;
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'theme/vscode-2026.json'), 'utf8'),
) as ThemeManifest;

describe('pinned VS Code 2026 theme manifest', () => {
  it('remains pinned to the approved upstream snapshot', () => {
    expect(manifest.source).toMatchObject({
      version: '1.134.0',
      commit: '474a349ad5b745e512ef86b864d1c74f7264dd7a',
    });
  });

  it('provides identical semantic token coverage in both themes', () => {
    const light = Object.keys(manifest.themes['light-2026']).sort();
    const dark = Object.keys(manifest.themes['dark-2026']).sort();
    expect(dark).toEqual(light);
  });

  it('preserves representative exact upstream UI colors', () => {
    expect(manifest.themes['light-2026']).toMatchObject({
      'editor.background': '#FFFFFF',
      'button.background': '#0069CC',
      focusBorder: '#0069CCFF',
    });
    expect(manifest.themes['dark-2026']).toMatchObject({
      'editor.background': '#121314',
      'button.background': '#297AA0',
      focusBorder: '#3994BCB3',
    });
  });
});
