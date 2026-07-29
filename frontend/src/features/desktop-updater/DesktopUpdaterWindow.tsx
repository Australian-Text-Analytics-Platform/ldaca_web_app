import { useEffect, useEffectEvent, useState } from 'react';
import { CheckCircle2, Download, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  checkDesktopUpdate,
  hideDesktopUpdaterWindow,
  listenForDesktopUpdateCheck,
  relaunchDesktopApp,
  showDesktopUpdaterWindow,
  type DesktopUpdate,
} from './desktopUpdaterRuntime';

type DesktopUpdaterStatus =
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'installing'
  | 'restarting'
  | 'error';

/** Owns update checks and installation inside the dedicated native updater window. */
export function DesktopUpdaterWindow() {
  const [status, setStatus] = useState<DesktopUpdaterStatus>('checking');
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdate | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadSize, setDownloadSize] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (availableUpdate) void availableUpdate.close();
    },
    [availableUpdate],
  );

  const checkNow = async (manual: boolean) => {
    if (status === 'checking') {
      if (manual) await showDesktopUpdaterWindow();
      return;
    }
    if (status === 'installing' || status === 'restarting') return;
    if (status === 'available' && availableUpdate) {
      await showDesktopUpdaterWindow();
      return;
    }

    setStatus('checking');
    setErrorMessage(null);
    if (manual) await showDesktopUpdaterWindow();
    try {
      const update = await checkDesktopUpdate();
      if (!update) {
        setAvailableUpdate(null);
        setStatus('up-to-date');
        return;
      }
      setAvailableUpdate(update);
      setStatus('available');
      await showDesktopUpdaterWindow();
    } catch (error: unknown) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not check for updates.');
    }
  };

  const handleNativeUpdateCheck = useEffectEvent(() => {
    void checkNow(true);
  });

  useEffect(() => {
    let active = true;
    void checkDesktopUpdate()
      .then((update) => {
        if (!active) {
          if (update) void update.close();
          return;
        }
        if (!update) {
          setStatus('up-to-date');
          return;
        }
        setAvailableUpdate(update);
        setStatus('available');
        void showDesktopUpdaterWindow();
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Could not check for updates.');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenForDesktopUpdateCheck(handleNativeUpdateCheck).then((stopListening) => {
      if (active) unlisten = stopListening;
      else stopListening();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const installUpdate = async () => {
    if (!availableUpdate || status === 'installing' || status === 'restarting') return;

    setStatus('installing');
    setDownloadedBytes(0);
    setDownloadSize(null);
    setErrorMessage(null);
    try {
      let received = 0;
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setDownloadSize(event.data.contentLength ?? null);
          return;
        }
        if (event.event === 'Progress') {
          received += event.data.chunkLength;
          setDownloadedBytes(received);
        }
      });
      setStatus('restarting');
      await relaunchDesktopApp();
    } catch (error: unknown) {
      setStatus('available');
      setErrorMessage(error instanceof Error ? error.message : 'Could not install the update.');
    }
  };

  const progressPercent =
    downloadSize && downloadSize > 0
      ? Math.min(100, Math.round((downloadedBytes / downloadSize) * 100))
      : null;
  const busy = status === 'installing' || status === 'restarting';

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <section className="w-full max-w-md space-y-6" aria-live="polite">
        <div className="flex justify-center">
          {status === 'checking' || busy ? (
            <LoaderCircle className="size-12 animate-spin text-primary" aria-hidden="true" />
          ) : status === 'error' ? (
            <TriangleAlert className="size-12 text-destructive" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-12 text-primary" aria-hidden="true" />
          )}
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold">
            {status === 'checking'
              ? 'Checking for updates…'
              : status === 'up-to-date'
                ? 'LDaCA Wordflow is up to date'
                : status === 'error'
                  ? 'Could not check for updates'
                  : `LDaCA Wordflow ${availableUpdate?.version ?? ''} is available`}
          </h1>
          {status === 'available' || busy ? (
            <p className="text-sm text-muted-foreground">
              The signed update will be verified before installation. Wordflow will restart after
              the download completes.
            </p>
          ) : null}
        </div>

        {availableUpdate?.body && (status === 'available' || busy) ? (
          <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
            {availableUpdate.body}
          </div>
        ) : null}

        {busy ? (
          <div className="space-y-2">
            <Progress value={progressPercent ?? 0} />
            <p className="text-center text-sm text-muted-foreground">
              {status === 'restarting'
                ? 'Update installed. Restarting Wordflow…'
                : progressPercent === null
                  ? 'Downloading update…'
                  : `Downloading update… ${String(progressPercent)}%`}
            </p>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        {status !== 'checking' ? (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void hideDesktopUpdaterWindow()}
            >
              {status === 'available' ? 'Later' : 'Close'}
            </Button>
            {status === 'available' || busy ? (
              <Button type="button" disabled={busy} onClick={() => void installUpdate()}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Download />}
                Download and restart
              </Button>
            ) : status === 'error' ? (
              <Button type="button" onClick={() => void checkNow(true)}>
                <RefreshCw />
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
