/// <reference lib="webworker" />

/**
 * Web Worker for pyodide + polars expression serialization.
 *
 * Loads pyodide from CDN on first use, installs polars via micropip,
 * then accepts "serialize" messages that evaluate user Python code and
 * return the JSON IR of the resulting polars expression(s).
 */

interface PyodideInterface {
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (key: string) => unknown };
  loadPackage: (pkg: string | string[]) => Promise<void>;
}

interface PyodideModule {
  loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface>;
}

type WorkerInMessage =
  | { id: string; type: 'init' }
  | { id: string; type: 'validate'; code: string };

type WorkerOutMessage =
  | { id: string; type: 'ready' }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'validated' };

const PYODIDE_VERSION = '0.27.5';
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodide: PyodideInterface | null = null;
let initPromise: Promise<PyodideInterface> | null = null;

async function initPyodide(): Promise<PyodideInterface> {
  const { loadPyodide } = await (import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`) as Promise<PyodideModule>);
  pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

  // Install micropip then polars
  await pyodide.loadPackage('micropip');
  await pyodide.runPythonAsync(`
import micropip
await micropip.install('polars')
import polars as pl
`);
  return pyodide;
}

function ensureInit(): Promise<PyodideInterface> {
  if (!initPromise) {
    initPromise = initPyodide();
  }
  return initPromise;
}

const VALIDATE_WRAPPER = (userCode: string) => `
import polars as pl

# User code should assign to 'result': a pl.Expr or list[pl.Expr]
${userCode}

if isinstance(result, list):
    for _e in result:
        if not isinstance(_e, pl.Expr):
            raise TypeError(f'Expected pl.Expr in list, got {type(_e).__name__}')
elif not isinstance(result, pl.Expr):
    raise TypeError(f'result must be pl.Expr or list[pl.Expr], got {type(result).__name__}')
`;

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      await ensureInit();
      const out: WorkerOutMessage = { id: msg.id, type: 'ready' };
      self.postMessage(out);
    } catch (err) {
      const out: WorkerOutMessage = {
        id: msg.id,
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(out);
    }
    return;
  }

  if (msg.type === 'validate') {
    try {
      await ensureInit();
      const wrappedCode = VALIDATE_WRAPPER(msg.code);
      const p = await ensureInit();
      await p.runPythonAsync(wrappedCode);
      const out: WorkerOutMessage = { id: msg.id, type: 'validated' };
      self.postMessage(out);
    } catch (err) {
      const out: WorkerOutMessage = {
        id: msg.id,
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(out);
    }
    return;
  }
};

export {};
