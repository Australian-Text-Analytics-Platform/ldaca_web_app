#!/usr/bin/env node
/** Builds and stages the single Python runtime consumed by Tauri packaging. */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_RUNTIME_PYTHON = '3.14';

export function parseRuntimePreparationArgs(args) {
    const unknownArgs = args.filter((arg) => arg !== '--no-sources');
    if (unknownArgs.length > 0) {
        throw new Error(`Unknown backend runtime argument: ${unknownArgs[0]}`);
    }
    return { noSources: args.includes('--no-sources') };
}

export function runtimePreparationSteps(repoRoot, { noSources = false } = {}) {
    const packageArgs = [
        'run',
        '--no-project',
        '--python',
        BACKEND_RUNTIME_PYTHON,
        'python',
        'scripts/package_backend_runtime.py',
        '--clean',
        '--python-version',
        BACKEND_RUNTIME_PYTHON,
    ];
    if (noSources) packageArgs.push('--no-sources');

    return [
        {
            command: 'uv',
            args: packageArgs,
            cwd: repoRoot,
        },
        {
            command: process.execPath,
            args: ['frontend/scripts/stage-backend-runtime.mjs'],
            cwd: repoRoot,
        },
    ];
}

export function prepareBackendRuntime(repoRoot, options) {
    for (const step of runtimePreparationSteps(repoRoot, options)) {
        const result = spawnSync(step.command, step.args, {
            cwd: step.cwd,
            stdio: 'inherit',
            env: process.env,
        });
        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
    const options = parseRuntimePreparationArgs(process.argv.slice(2));
    prepareBackendRuntime(resolve(dirname(scriptPath), '..'), options);
}
