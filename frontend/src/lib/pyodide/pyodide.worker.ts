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

interface PyodideProxy {
  toJs: (opts?: { dict_converter?: typeof Object.fromEntries }) => unknown[];
}

// loadPyodide is injected into globalThis by importScripts(pyodide.js)
function loadPyodide(opts: { indexURL: string }): Promise<PyodideInterface> {
  return (globalThis as unknown as { loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface> }).loadPyodide(opts);
}

type WorkerInMessage =
  | { id: string; type: 'init' }
  | { id: string; type: 'serialize'; code: string };

type WorkerOutMessage =
  | { id: string; type: 'ready' }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'serialized'; expressions: object[] };

const PYODIDE_VERSION = '0.27.5';
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodide: PyodideInterface | null = null;
let initPromise: Promise<PyodideInterface> | null = null;

async function initPyodide(): Promise<PyodideInterface> {
  // Load the pyodide runtime script from CDN
  self.importScripts(`${PYODIDE_INDEX_URL}pyodide.js`);

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

const SERIALIZE_WRAPPER = (userCode: string) => `
import polars as pl, json as _json

# User code should assign to 'result': a pl.Expr or list[pl.Expr]
${userCode}

def _serialize_expr(e):
    return _json.loads(e.meta.serialize(format="json"))

if isinstance(result, list):
    _serialized = [_serialize_expr(e) for e in result]
elif isinstance(result, pl.Expr):
    _serialized = [_serialize_expr(result)]
else:
    raise TypeError(f"result must be pl.Expr or list[pl.Expr], got {type(result).__name__}")

_serialized
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

  if (msg.type === 'serialize') {
    try {
      await ensureInit();
      const wrappedCode = SERIALIZE_WRAPPER(msg.code);
      const p = await ensureInit();
      const pyResult = await p.runPythonAsync(wrappedCode);
      // pyResult is a Python list; convert to JS array
      const expressions = (pyResult as PyodideProxy).toJs({ dict_converter: Object.fromEntries });
      const out: WorkerOutMessage = { id: msg.id, type: 'serialized', expressions: expressions as object[] };
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
