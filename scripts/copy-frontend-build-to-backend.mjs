import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const sourceDir = resolve(repoRoot, 'frontend', 'build')
const targetDir = resolve(
    repoRoot,
    'backend',
    'src',
    'ldaca_web_app',
    'resources',
    'frontend',
    'build',
)

if (!existsSync(sourceDir)) {
    throw new Error(`Frontend build directory not found: ${sourceDir}`)
}

rmSync(targetDir, { force: true, recursive: true })
mkdirSync(targetDir, { recursive: true })
cpSync(sourceDir, targetDir, { recursive: true })

console.log(`Copied frontend build from ${sourceDir} to ${targetDir}`)