import concurrently from 'concurrently';
import { pathToFileURL } from 'node:url';

const frontendCommand = 'pnpm -C frontend dev';

function developmentPort(environment, name, fallback) {
  const value = environment[name] ?? fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error(`${name} must be a port between 1 and 65535`);
  }
  return value;
}

export function parseDevMode(arguments_) {
  if (arguments_.length === 0) {
    return 'web';
  }
  if (arguments_.length === 1 && arguments_[0] === '--backend') {
    return 'backend';
  }
  if (arguments_.length === 1 && arguments_[0] === '--frontend') {
    return 'frontend';
  }
  throw new Error('Usage: pnpm dev [--backend | --frontend]');
}

export function createDevCommands(mode, environment = process.env) {
  const frontendPort = developmentPort(environment, 'FRONTEND_PORT', '3000');
  const backendPort = developmentPort(environment, 'VITE_BACKEND_PORT', '8001');
  const developmentCorsOrigins = [
    `http://localhost:${frontendPort}`,
    `http://127.0.0.1:${frontendPort}`,
  ];
  const backend = {
    command:
      'uv run --project backend uvicorn ldaca_wordflow.asgi:app ' +
      `--reload --port ${backendPort}`,
    name: 'backend',
    prefixColor: 'blue',
    env: {
      CORS_ALLOWED_ORIGINS:
        environment.CORS_ALLOWED_ORIGINS ??
        JSON.stringify(developmentCorsOrigins),
    },
  };
  const frontend = {
    command: frontendCommand,
    name: 'frontend',
    prefixColor: 'magenta',
  };

  if (mode === 'backend') {
    return [backend];
  }
  if (mode === 'frontend') {
    return [frontend];
  }
  return [backend, frontend];
}

export async function runDev(arguments_ = process.argv.slice(2)) {
  const mode = parseDevMode(arguments_);
  const { result } = concurrently(createDevCommands(mode), {
    killOthersOn: ['success', 'failure'],
    prefix: 'name',
  });
  await result;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  try {
    await runDev();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}
