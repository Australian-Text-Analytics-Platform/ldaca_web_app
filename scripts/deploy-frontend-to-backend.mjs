import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
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
)
const archivePath = resolve(targetDir, 'build.tar.gz')
const extractedDir = resolve(targetDir, 'build')

if (!existsSync(sourceDir)) {
    throw new Error(`Frontend build directory not found: ${sourceDir}`)
}

// Clean previous artifacts
rmSync(archivePath, { force: true })
rmSync(extractedDir, { force: true, recursive: true })
mkdirSync(targetDir, { recursive: true })

// Create tar.gz archive from the frontend build directory
execSync(`tar -czf "${archivePath}" -C "${resolve(sourceDir, '..')}" build`, {
    stdio: 'inherit',
})
console.log(`Created ${archivePath}`)

// Decompress for local development use
execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: 'inherit' })
console.log(`Extracted build to ${extractedDir}`)
