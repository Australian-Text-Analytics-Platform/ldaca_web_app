import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncPublishedDocs, validatePublishedDocs } from './sync-published-docs.mjs';

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'wordflow-docs-sync-'));
  const frontendDir = join(root, 'frontend');
  const targetDir = join(root, 'ldaca-wordflow-docs');
  await mkdir(join(frontendDir, 'public', 'tutorials', 'assets'), { recursive: true });
  await mkdir(join(frontendDir, 'public', 'information'), { recursive: true });
  await mkdir(join(frontendDir, 'public', 'references'), { recursive: true });
  await mkdir(join(targetDir, '.git'), { recursive: true });
  await mkdir(join(targetDir, 'scripts'), { recursive: true });
  await mkdir(join(targetDir, 'warnings'), { recursive: true });
  await mkdir(join(targetDir, 'assets'), { recursive: true });
  await writeFile(join(frontendDir, 'package.json'), '{"version":"0.7.1"}\n');
  await writeFile(join(frontendDir, 'public', 'tutorials', 'index.md'), '# Current\n');
  await writeFile(join(frontendDir, 'public', 'tutorials', 'assets', 'plot.png'), 'plot');
  await writeFile(join(frontendDir, 'public', 'information', 'about.md'), '# About\n');
  await writeFile(join(frontendDir, 'public', 'references', 'general.md'), '# Reference\n');
  await writeFile(join(targetDir, 'tutorials-old.md'), 'maintainer file\n');
  await writeFile(join(targetDir, 'warnings', 'old.md'), '# Obsolete\n');
  await writeFile(join(targetDir, 'assets', 'old.png'), 'obsolete');
  await writeFile(join(targetDir, 'README.md'), 'preserve me\n');
  await writeFile(
    join(targetDir, 'scripts', 'build-registry.mjs'),
    "import { writeFile } from 'node:fs/promises'; await writeFile('.validated', 'yes');\n",
  );
  return { frontendDir, targetDir };
}

describe('published documentation sync', () => {
  it('mirrors frontend docs, prunes obsolete content, and preserves maintainer files', async () => {
    const { frontendDir, targetDir } = await createFixture();

    await syncPublishedDocs({
      frontendDir,
      targetDir,
      generatedDate: '2026-08-04',
      registry: {
        tutorial: { index: { file: 'tutorials/index.md', anchor: '' } },
        info: {},
        reference: {},
      },
    });

    expect(await readFile(join(targetDir, 'tutorials', 'index.md'), 'utf8')).toBe('# Current\n');
    expect(await readFile(join(targetDir, 'tutorials', 'assets', 'plot.png'), 'utf8')).toBe(
      'plot',
    );
    expect(await readFile(join(targetDir, 'README.md'), 'utf8')).toBe('preserve me\n');
    expect(await readdir(targetDir)).not.toContain('warnings');
    expect(await readdir(targetDir)).not.toContain('assets');
    expect(JSON.parse(await readFile(join(targetDir, 'registry.json'), 'utf8'))).toEqual({
      meta: { version: '0.7.1', generated: '2026-08-04' },
      tutorial: { index: { file: 'tutorials/index.md', anchor: '' } },
      info: {},
      reference: {},
    });
  });

  it('runs the mirror repository registry validator', async () => {
    const { targetDir } = await createFixture();

    validatePublishedDocs(targetDir);

    expect(await readFile(join(targetDir, '.validated'), 'utf8')).toBe('yes');
  });
});
