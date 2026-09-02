import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconsRoot = resolve(frontendRoot, 'src-tauri/icons');
const source = resolve(iconsRoot, 'wordflow.icon');
const destination = resolve(iconsRoot, 'Assets.car');
const workRoot = mkdtempSync(join(tmpdir(), 'wordflow-icon-'));
const workIcon = resolve(workRoot, 'Icon.icon');
const output = resolve(workRoot, 'out');

try {
  cpSync(source, workIcon, { recursive: true });
  mkdirSync(output);

  const result = spawnSync(
    'xcrun',
    [
      'actool',
      workIcon,
      '--compile',
      output,
      '--output-format',
      'human-readable-text',
      '--notices',
      '--warnings',
      '--output-partial-info-plist',
      resolve(output, 'assetcatalog_generated_info.plist'),
      '--app-icon',
      'Icon',
      '--include-all-app-icons',
      '--accent-color',
      'AccentColor',
      '--enable-on-demand-resources',
      'NO',
      '--development-region',
      'en',
      '--target-device',
      'mac',
      '--minimum-deployment-target',
      '26.0',
      '--platform',
      'macosx',
    ],
    { stdio: 'inherit' },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    const compiled = resolve(output, 'Assets.car');
    if (!existsSync(compiled)) throw new Error('actool did not produce Assets.car');
    copyFileSync(compiled, destination);
    console.log(`Compiled macOS icon catalog: ${destination}`);
  }
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
