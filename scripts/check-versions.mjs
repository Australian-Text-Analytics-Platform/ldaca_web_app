#!/usr/bin/env node
// Asserts every version-bearing file in this repo agrees on the same
// semver. Wired into release.yml as a pre-build gate so a tag-and-push
// cannot ship an inconsistent set of artifacts (the v0.4.3 footgun).
//
// Exit codes:
//   0 — all versions match
//   1 — drift detected
//   2 — a target file has no recognisable version field

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

// Keep this list in lockstep with bump-version.mjs::TARGETS.
const TARGETS = [
    {
        label: 'workspace pyproject.toml',
        path: 'pyproject.toml',
        extract: (src) => src.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    },
    {
        label: 'backend/pyproject.toml',
        path: 'backend/pyproject.toml',
        extract: (src) => src.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    },
    {
        label: 'frontend/package.json',
        path: 'frontend/package.json',
        extract: (src) => src.match(/"version"\s*:\s*"([^"]+)"/)?.[1],
    },
    {
        label: 'frontend/src-tauri/Cargo.toml',
        path: 'frontend/src-tauri/Cargo.toml',
        extract: (src) =>
            src.match(/\[package\][\s\S]*?\n\s*version\s*=\s*"([^"]+)"/)?.[1],
    },
    {
        label: 'frontend/src-tauri/tauri.conf.json',
        path: 'frontend/src-tauri/tauri.conf.json',
        extract: (src) => src.match(/"version"\s*:\s*"([^"]+)"/)?.[1],
    },
]

const widest = Math.max(...TARGETS.map((t) => t.label.length))

const seen = []
let missing = false
for (const t of TARGETS) {
    const src = await readFile(resolve(repoRoot, t.path), 'utf8')
    const v = t.extract(src)
    if (!v) {
        console.error(`x ${t.label.padEnd(widest)}  no version field at ${t.path}`)
        missing = true
        continue
    }
    seen.push({ label: t.label, version: v })
    console.log(`  ${t.label.padEnd(widest)}  ${v}`)
}
if (missing) process.exit(2)

const distinct = [...new Set(seen.map((s) => s.version))]
if (distinct.length === 1) {
    console.log(`\nAll versions match (${distinct[0]}).`)
    process.exit(0)
}

console.error(`\nVersion drift: ${distinct.join(' / ')}`)
console.error(`Run \`npm run bump-version <semver>\` to realign.`)
process.exit(1)
