import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BACKEND_RUNTIME_PYTHON,
    runtimePreparationSteps,
} from './prepare-backend-runtime.mjs';

test('one runtime command owns packaging, version selection, and staging', () => {
    const steps = runtimePreparationSteps('/repo');
    assert.equal(BACKEND_RUNTIME_PYTHON, '3.14t');
    assert.deepEqual(steps[0].args, [
        'run',
        '--no-project',
        '--python',
        '3.14t',
        'python',
        'scripts/package_backend_runtime.py',
        '--clean',
        '--python-version',
        '3.14t',
    ]);
    assert.deepEqual(steps[1].args, ['frontend/scripts/stage-backend-runtime.mjs']);
});
