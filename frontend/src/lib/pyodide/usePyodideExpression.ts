import { useCallback, useEffect, useRef, useState } from 'react';

export type PyodideStatus = 'idle' | 'loading' | 'ready' | 'error';

let sharedWorker: Worker | null = null;
let workerReady = false;
const pendingCallbacks = new Map<string, (err: Error | null) => void>();

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' });
    sharedWorker.onmessage = (event) => {
      const msg = event.data as { id: string; type: string; message?: string };
      const cb = pendingCallbacks.get(msg.id);
      if (!cb) return;
      pendingCallbacks.delete(msg.id);

      if (msg.type === 'error') {
        cb(new Error(msg.message ?? 'Unknown pyodide error'));
      } else {
        // 'ready' and 'validated' are both success signals
        cb(null);
      }
    };
  }
  return sharedWorker;
}

let idCounter = 0;
function nextId(): string {
  return `pyodide-${++idCounter}`;
}

function sendToWorker(type: string, payload: object = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = nextId();
    const worker = getWorker();
    pendingCallbacks.set(id, (err) => {
      if (err) reject(err);
      else resolve();
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
    pendingCallbacks.set(id, (err) => {
      if (err) {
        setStatus('error');
        setInitError(err.message);
      } else {
        workerReady = true;
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

  const validate = useCallback(
    async (code: string): Promise<void> => {
      if (!workerReady) {
        throw new Error('Pyodide is not ready yet');
      }
      await sendToWorker('validate', { code });
    },
    [],
  );

  return { status, initError, validate };
}
