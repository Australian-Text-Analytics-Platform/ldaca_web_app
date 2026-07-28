import { useEffect, useState, type ReactNode } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { isTauri } from '@/lib/isTauri';
import {
  checkDesktopUpdate,
  getDesktopVersion,
  relaunchDesktopApp,
  type DesktopUpdate,
} from './desktopUpdaterRuntime';
import {
  DesktopUpdaterContext,
  type DesktopUpdaterContextValue,
  type DesktopUpdaterStatus,
} from './desktopUpdaterContext';

/**
 * Owns the desktop update lifecycle for the whole application.
 *
 * Tauri performs signature verification and installation. React owns only the
 * user prompt, progress presentation, and explicit restart consent.
 */
export function DesktopUpdaterProvider({ children }: { children: ReactNode }) {
  const desktopRuntime = isTauri();
  const [status, setStatus] = useState<DesktopUpdaterStatus>(desktopRuntime ? 'checking' : 'idle');
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdate | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadSize, setDownloadSize] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopRuntime) return;

    let active = true;
    void getDesktopVersion()
      .then((version) => {
        if (active) setCurrentVersion(version);
      })
      .catch(() => undefined);
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
        setPromptOpen(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Could not check for updates.');
      });

    return () => {
      active = false;
    };
  }, [desktopRuntime]);

  useEffect(
    () => () => {
      if (availableUpdate) void availableUpdate.close();
    },
    [availableUpdate],
  );

  const checkNow = async () => {
    if (!desktopRuntime || status === 'checking' || status === 'installing') return;
    if (status === 'available' && availableUpdate) {
      setPromptOpen(true);
      return;
    }

    setStatus('checking');
    setErrorMessage(null);
    try {
      const update = await checkDesktopUpdate();
      if (!update) {
        setAvailableUpdate(null);
        setStatus('up-to-date');
        toast.success('LDaCA Wordflow is up to date.');
        return;
      }
      setAvailableUpdate(update);
      setStatus('available');
      setPromptOpen(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not check for updates.';
      setStatus('error');
      setErrorMessage(message);
      toast.error('Update check failed', { description: message });
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate || status === 'installing') return;

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
      const message = error instanceof Error ? error.message : 'Could not install the update.';
      setStatus('error');
      setErrorMessage(message);
      toast.error('Update installation failed', { description: message });
    }
  };

  const progressPercent =
    downloadSize && downloadSize > 0
      ? Math.min(100, Math.round((downloadedBytes / downloadSize) * 100))
      : null;

  const contextValue: DesktopUpdaterContextValue = {
    status,
    currentVersion,
    availableVersion: availableUpdate?.version ?? null,
    progressPercent,
    errorMessage,
    checkNow,
  };

  return (
    <DesktopUpdaterContext.Provider value={contextValue}>
      {children}
      <AlertDialog
        open={promptOpen && availableUpdate !== null}
        onOpenChange={(open) => {
          if (status !== 'installing' && status !== 'restarting') setPromptOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              LDaCA Wordflow {availableUpdate?.version} is available
            </AlertDialogTitle>
            <AlertDialogDescription>
              The update is signed and will be verified before installation. Wordflow will restart
              after the download completes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {availableUpdate?.body ? (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
              {availableUpdate.body}
            </div>
          ) : null}
          {status === 'installing' || status === 'restarting' ? (
            <div className="space-y-2" aria-live="polite">
              <Progress value={progressPercent ?? 0} />
              <p className="text-sm text-muted-foreground">
                {status === 'restarting'
                  ? 'Update installed. Restarting Wordflow…'
                  : progressPercent === null
                    ? 'Downloading update…'
                    : `Downloading update… ${String(progressPercent)}%`}
              </p>
            </div>
          ) : null}
          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={status === 'installing' || status === 'restarting'}
              onClick={() => {
                setPromptOpen(false);
              }}
            >
              Later
            </Button>
            <Button
              type="button"
              disabled={status === 'installing' || status === 'restarting'}
              onClick={() => {
                void installUpdate();
              }}
            >
              {status === 'installing' || status === 'restarting' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Download />
              )}
              Download and restart
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DesktopUpdaterContext.Provider>
  );
}
