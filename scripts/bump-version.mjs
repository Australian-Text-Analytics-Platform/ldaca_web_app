#!/usr/bin/env node
// Updates every version-bearing file in this repo to <new-version> in one
// pass. Run as `npm run bump-version 0.5.0` from the wordflow repo root.
//
// The set of files maintained here is the same set that ships an
// independently-stamped version — drift between them is what shipped the
// v0.4.3 "desktop assets say 0.4.2 / pip says 0.4.3" bug. The companion
// `check-versions.mjs` is wired into release.yml as a pre-build gate.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

const SEMVER = /^\d+\.\d+\.\d+([.-][\w.]+)?$/
const target = process.argv[2]
if (!target || !SEMVER.test(target)) {
    console.error('Usage: node scripts/bump-version.mjs <semver>')
    console.error('Example: node scripts/bump-version.mjs 0.5.0')
    process.exit(1)
}

// Per-file (path, label, replacer). Replacers are regex-based rather than
// AST-based so they don't depend on the file's full schema — we only touch
// the one declared version line and leave everything else byte-identical.
const TARGETS = [
    {
        label: 'workspace pyproject.toml',
        path: 'pyproject.toml',
        replace: (src, v) =>
            src.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${v}"`),
    },
    {
        label: 'backend/pyproject.toml',
        path: 'backend/pyproject.toml',
        replace: (src, v) =>
            src.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${v}"`),
    },
    {
        label: 'frontend/package.json',
        path: 'frontend/package.json',
        replace: (src, v) =>
            src.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${v}"`),
    },
    {
        label: 'frontend/src-tauri/Cargo.toml',
        path: 'frontend/src-tauri/Cargo.toml',
        replace: (src, v) =>
            // Match the [package] block's version, not e.g. [build-dependencies].
            src.replace(
                /(\[package\][\s\S]*?\n\s*version\s*=\s*)"[^"]+"/,
                `$1"${v}"`,
            ),
    },
    {
        label: 'frontend/src-tauri/tauri.conf.json',
        path: 'frontend/src-tauri/tauri.conf.json',
        replace: (src, v) =>
            src.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${v}"`),
    },
]

const widest = Math.max(...TARGETS.map((t) => t.label.length))

let drift = false
for (const t of TARGETS) {
    const fullPath = resolve(repoRoot, t.path)
    const src = await readFile(fullPath, 'utf8')
    const before = src.match(
        /(?:^version\s*=\s*|"version"\s*:\s*)"([^"]+)"/m,
    )?.[1]
    const next = t.replace(src, target)
    if (next === src) {
        if (before === target) {
            console.log(`= ${t.label.padEnd(widest)}  already ${target}`)
            continue
        }
        console.error(`x ${t.label.padEnd(widest)}  no version field matched`)
        drift = true
        continue
    }
    await writeFile(fullPath, next)
    console.log(`+ ${t.label.padEnd(widest)}  ${before} -> ${target}`)
}

if (drift) process.exit(2)

console.log(
    `\nNext: \`npm run deploy_frontend_to_backend\` to rebuild the FE bundle\n` +
        `      (VITE_APP_VERSION is baked in at build time) and commit both\n` +
        `      repos. Cargo.lock regenerates on next \`cargo build\`.`,
)
