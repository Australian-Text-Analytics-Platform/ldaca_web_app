import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const tauriTarget = resolve(import.meta.dirname, '../src-tauri/target');
const releaseRoots = [
  resolve(tauriTarget, 'release/bundle'),
  resolve(tauriTarget, 'aarch64-apple-darwin/release/bundle'),
  resolve(tauriTarget, 'x86_64-apple-darwin/release/bundle'),
];

await Promise.all(
  releaseRoots.flatMap((bundleRoot) => [
    rm(resolve(bundleRoot, 'macos/LDaCA Wordflow.app'), { recursive: true, force: true }),
    rm(resolve(bundleRoot, 'dmg'), { recursive: true, force: true }),
  ]),
);

console.log('Removed previous macOS app and DMG bundles.');
