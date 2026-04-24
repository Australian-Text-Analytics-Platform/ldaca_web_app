import { useCallback, useEffect, useRef, useState } from 'react';

export type PyodideStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SerializeResult {
  expressions: object[];
}

let sharedWorker: Worker | null = null;
let workerReady = false;
const pendingCallbacks = new Map<string, (result: SerializeResult | Error) => void>();

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'classic' });
    sharedWorker.onmessage = (event) => {
      const msg = event.data as { id: string; type: string; expressions?: object[]; message?: string };
      const cb = pendingCallbacks.get(msg.id);
      if (!cb) return;
      pendingCallbacks.delete(msg.id);

      if (msg.type === 'error') {
        cb(new Error(msg.message ?? 'Unknown pyodide error'));
      } else if (msg.type === 'serialized') {
        cb({ expressions: msg.expressions ?? [] });
      } else if (msg.type === 'ready') {
        workerReady = true;
        cb({ expressions: [] }); // init signal
      }
    };
  }
  return sharedWorker;
}

let idCounter = 0;
function nextId(): string {
  return `pyodide-${++idCounter}`;
}

function sendToWorker(type: string, payload: object = {}): Promise<{ id: string; type: string; expressions?: object[]; message?: string }> {
  return new Promise((resolve, reject) => {
    const id = nextId();
    const worker = getWorker();
    pendingCallbacks.set(id, (result) => {
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve({ id, type: 'serialized', expressions: result.expressions });
      }
    });
    worker.postMessage({ id, type, ...payload });
  });
}

/** Hook that gives access to pyodide-backed polars expression serialization. */
export function usePyodideExpression() {
  const [status, setStatus] = useState<PyodideStatus>('idle');
  const [initError, setInitError] = useState<string | null>(null);
  const initStarted = useRef(false);

  const init = useCallback(() => {
    if (initStarted.current) return;
    initStarted.current = true;
    if (workerReady) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    const id = nextId();
    const worker = getWorker();
    pendingCallbacks.set(id, (result) => {
      if (result instanceof Error) {
        setStatus('error');
        setInitError(result.message);
      } else {
        setStatus('ready');
      }
    });
    worker.postMessage({ id, type: 'init' });
  }, []);

  // Auto-init when hook mounts (lazy: only when component using it mounts)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- Triggering worker init and syncing status; no cascading renders */
    init();
  }, [init]);

  const serialize = useCallback(
    async (code: string): Promise<object[]> => {
      if (!workerReady) {
        throw new Error('Pyodide is not ready yet');
      }
      const result = await sendToWorker('serialize', { code });
      return result.expressions ?? [];
    },
    [],
  );

  return { status, initError, serialize };
}
