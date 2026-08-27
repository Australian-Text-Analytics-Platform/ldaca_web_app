import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BACKEND_RUNTIME_PYTHON,
    parseRuntimePreparationArgs,
    runtimePreparationSteps,
} from './prepare-backend-runtime.mjs';

test('one runtime command owns packaging, version selection, and staging', () => {
    const steps = runtimePreparationSteps('/repo');
    assert.equal(BACKEND_RUNTIME_PYTHON, '3.14');
    assert.deepEqual(steps[0].args, [
        'run',
        '--no-project',
        '--python',
        '3.14',
        'python',
        'scripts/package_backend_runtime.py',
        '--clean',
        '--python-version',
        '3.14',
    ]);
    assert.deepEqual(steps[1].args, ['frontend/scripts/stage-backend-runtime.mjs']);
});

test('published-package mode is explicit and forwards uv no-sources', () => {
    assert.deepEqual(parseRuntimePreparationArgs([]), { noSources: false });
    assert.deepEqual(parseRuntimePreparationArgs(['--no-sources']), {
        noSources: true,
    });
    assert.throws(
        () => parseRuntimePreparationArgs(['--unknown']),
        /Unknown backend runtime argument: --unknown/,
    );

    const steps = runtimePreparationSteps('/repo', { noSources: true });
    assert.equal(steps[0].args.at(-1), '--no-sources');
});
