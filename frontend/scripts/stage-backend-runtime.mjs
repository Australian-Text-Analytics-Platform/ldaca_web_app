import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');
const sourceRuntime = path.join(repoRoot, 'backend', 'dist-tauri', 'backend-runtime');
const targetRuntime = path.join(
  frontendRoot,
  'src-tauri',
  'backend-runtime',
);

if (!fs.existsSync(sourceRuntime)) {
  console.error(`Backend runtime not found at: ${sourceRuntime}`);
  console.error('Run backend packaging first.');
  process.exit(1);
}

fs.rmSync(targetRuntime, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetRuntime), { recursive: true });
fs.cpSync(sourceRuntime, targetRuntime, { recursive: true });

const manifestPath = path.join(targetRuntime, 'runtime-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`runtime-manifest.json missing at: ${manifestPath}`);
  process.exit(1);
}

console.log(`Staged backend runtime to: ${targetRuntime}`);
