import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDevCommands,
  parseDevMode,
} from './dev.mjs';

test('the default development mode starts backend and frontend', () => {
  const commands = createDevCommands('web', {});

  assert.deepEqual(
    commands.map(({ name }) => name),
    ['backend', 'frontend'],
  );
  assert.equal(
    commands[0].env.CORS_ALLOWED_ORIGINS,
    '["http://localhost:3000","http://127.0.0.1:3000"]',
  );
  assert.equal(Object.hasOwn(commands[0].env, 'DATA_ROOT'), false);
});

test('backend development preserves an explicit CORS configuration', () => {
  const commands = createDevCommands('backend', {
    CORS_ALLOWED_ORIGINS: '["http://example.test:3000"]',
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'backend');
  assert.equal(
    commands[0].env.CORS_ALLOWED_ORIGINS,
    '["http://example.test:3000"]',
  );
});

test('frontend development can run independently', () => {
  assert.deepEqual(
    createDevCommands('frontend', {}).map(({ name }) => name),
    ['frontend'],
  );
});

test('development ports configure both processes and the CORS default', () => {
  const commands = createDevCommands('web', {
    FRONTEND_PORT: '3100',
    VITE_BACKEND_PORT: '8101',
  });

  assert.match(commands[0].command, /--port 8101$/);
  assert.equal(
    commands[0].env.CORS_ALLOWED_ORIGINS,
    '["http://localhost:3100","http://127.0.0.1:3100"]',
  );
  assert.throws(
    () => createDevCommands('web', { FRONTEND_PORT: 'not-a-port' }),
    /FRONTEND_PORT/,
  );
});

test('development mode arguments reject unsupported combinations', () => {
  assert.equal(parseDevMode([]), 'web');
  assert.equal(parseDevMode(['--backend']), 'backend');
  assert.equal(parseDevMode(['--frontend']), 'frontend');
  assert.throws(() => parseDevMode(['--backend', '--frontend']), /Usage/);
});
