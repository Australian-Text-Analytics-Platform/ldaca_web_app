import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, RefreshCw, Rocket } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  checkForUpdates,
  dismissUpdate,
  downloadUpdate,
  getUpdaterSnapshot,
  installUpdate,
  openUpdateLink,
  type UpdateMetadata,
} from './desktopUpdater';

type ViewState =
  | { status: 'checking' }
  | { status: 'upToDate'; currentVersion: string }
  | { status: 'available'; update: UpdateMetadata }
  | {
      status: 'downloading';
      update: UpdateMetadata;
      downloadedBytes: number;
      contentLength: number | null;
    }
  | { status: 'readyToInstall'; update: UpdateMetadata }
  | { status: 'installing' }
  | {
      status: 'error';
      message: string;
      retry: 'check' | 'download' | 'install';
      update?: UpdateMetadata;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ReleaseNotes({ notes }: { notes: string | null }) {
  if (!notes) {
    return <p className="text-body text-description">No release notes were provided.</p>;
  }

  return (
    <div className="prose prose-sm max-w-none text-foreground prose-a:text-link prose-img:hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            href?.startsWith('https://') ? (
              <button
                type="button"
                role="link"
                className="cursor-pointer text-link underline"
                onClick={() => void openUpdateLink(href)}
              >
                {children}
              </button>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (alt ? <span>{alt}</span> : null),
        }}
      >
        {notes}
      </ReactMarkdown>
    </div>
  );
}

function UpdateDetails({ update }: { update: UpdateMetadata }) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
      <div>
        <p className="text-heading-2 font-semibold">Wordflow {update.version}</p>
        <p className="mt-1 text-label-secondary text-description">
          {update.publicationDate
            ? `Published ${update.publicationDate}`
            : 'A new version is available'}
        </p>
      </div>
      <section
        aria-label="Release notes"
        className="rounded-md border border-surface-border bg-panel/30 p-4"
      >
        <ReleaseNotes notes={update.notes} />
      </section>
    </div>
  );
}

export function UpdaterWindow({ mode }: { mode: 'manual' | 'available' }) {
  const [view, setView] = useState<ViewState>({ status: 'checking' });

  const check = async () => {
    setView({ status: 'checking' });
    try {
      const outcome = await checkForUpdates();
      setView(outcome);
    } catch (error) {
      setView({ status: 'error', message: errorMessage(error), retry: 'check' });
    }
  };

  useEffect(() => {
    if (mode === 'manual') {
      void checkForUpdates()
        .then(setView)
        .catch((error: unknown) => {
          setView({ status: 'error', message: errorMessage(error), retry: 'check' });
        });
      return;
    }
    void getUpdaterSnapshot()
      .then((snapshot) => {
        switch (snapshot.status) {
          case 'available':
            setView(snapshot);
            break;
          case 'readyToInstall':
            setView(snapshot);
            break;
          case 'downloading':
            setView({
              status: 'downloading',
              update: snapshot.update,
              downloadedBytes: 0,
              contentLength: null,
            });
            break;
          case 'installing':
            setView({ status: 'installing' });
            break;
          case 'idle':
            void check();
            break;
        }
      })
      .catch((error: unknown) => {
        setView({ status: 'error', message: errorMessage(error), retry: 'check' });
      });
  }, [mode]);

  const download = async (update: UpdateMetadata) => {
    setView({ status: 'downloading', update, downloadedBytes: 0, contentLength: null });
    try {
      await downloadUpdate((event) => {
        if (event.event === 'started') {
          setView((current) =>
            current.status === 'downloading'
              ? { ...current, contentLength: event.data.contentLength }
              : current,
          );
        } else if (event.event === 'progress') {
          setView((current) =>
            current.status === 'downloading'
              ? { ...current, downloadedBytes: current.downloadedBytes + event.data.chunkLength }
              : current,
          );
        }
      });
      setView({ status: 'readyToInstall', update });
    } catch (error) {
      setView({ status: 'error', message: errorMessage(error), retry: 'download', update });
    }
  };

  const install = async (update: UpdateMetadata) => {
    setView({ status: 'installing' });
    try {
      await installUpdate();
    } catch (error) {
      setView({ status: 'error', message: errorMessage(error), retry: 'install', update });
    }
  };

  const retry = () => {
    if (view.status !== 'error') return;
    if (view.retry === 'download' && view.update) void download(view.update);
    else if (view.retry === 'install' && view.update) void install(view.update);
    else void check();
  };

  const progress =
    view.status === 'downloading' && view.contentLength
      ? Math.min(100, (view.downloadedBytes / view.contentLength) * 100)
      : null;

  return (
    <main className="flex h-dvh min-h-[30rem] flex-col bg-editor text-foreground">
      <header className="border-b border-surface-border px-6 py-4">
        <p className="text-heading-3 font-semibold">LDaCA Wordflow Update</p>
        <p className="mt-1 text-label-secondary text-description">
          Keep Wordflow current and secure.
        </p>
      </header>

      {view.status === 'available' && <UpdateDetails update={view.update} />}
      {view.status === 'readyToInstall' && <UpdateDetails update={view.update} />}

      {view.status === 'checking' && (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
          role="status"
        >
          <RefreshCw className="size-9 animate-spin text-link" aria-hidden />
          <div>
            <h1 className="text-heading-2 font-semibold">Checking for updates…</h1>
            <p className="mt-2 text-body text-description">This usually takes only a moment.</p>
          </div>
          <div
            className="h-1 w-full max-w-72 overflow-hidden bg-panel"
            role="progressbar"
            aria-label="Checking for updates"
          >
            <div className="h-full w-1/3 animate-pulse bg-button" />
          </div>
        </div>
      )}

      {view.status === 'upToDate' && (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
          role="status"
        >
          <CheckCircle2 className="size-10 text-chart-3" aria-hidden />
          <div>
            <h1 className="text-heading-2 font-semibold">Wordflow is up to date</h1>
            <p className="mt-2 text-body text-description">
              You’re using version {view.currentVersion}.
            </p>
          </div>
        </div>
      )}

      {view.status === 'downloading' && (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center"
          role="status"
        >
          <Download className="size-10 text-link" aria-hidden />
          <div>
            <h1 className="text-heading-2 font-semibold">
              Downloading Wordflow {view.update.version}
            </h1>
            <p className="mt-2 text-body text-description">
              {progress === null
                ? 'Preparing and verifying the update…'
                : `${String(Math.round(progress))}% complete`}
            </p>
          </div>
          {progress === null ? (
            <div
              className="h-1 w-full max-w-80 overflow-hidden bg-panel"
              aria-label="Downloading update"
            >
              <div className="h-full w-1/3 animate-pulse bg-button" />
            </div>
          ) : (
            <Progress className="max-w-80" value={progress} aria-label="Downloading update" />
          )}
        </div>
      )}

      {view.status === 'installing' && (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
          role="status"
        >
          <Rocket className="size-10 text-link" aria-hidden />
          <div>
            <h1 className="text-heading-2 font-semibold">Installing update…</h1>
            <p className="mt-2 text-body text-description">
              Wordflow will restart when installation finishes.
            </p>
          </div>
        </div>
      )}

      {view.status === 'error' && (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
          role="alert"
        >
          <AlertCircle className="size-10 text-error" aria-hidden />
          <div>
            <h1 className="text-heading-2 font-semibold">The update could not be completed</h1>
            <p className="mt-2 max-w-md text-body text-description">{view.message}</p>
          </div>
        </div>
      )}

      <footer className="flex min-h-16 items-center justify-end gap-2 border-t border-surface-border px-6 py-3">
        {view.status === 'available' && (
          <>
            <Button variant="ghost" onClick={() => void dismissUpdate('skip')}>
              Skip this version
            </Button>
            <Button variant="outline" onClick={() => void dismissUpdate('later')}>
              Decide later
            </Button>
            <Button onClick={() => void download(view.update)}>Update</Button>
          </>
        )}
        {view.status === 'readyToInstall' && (
          <>
            <Button variant="outline" onClick={() => void dismissUpdate('later')}>
              Decide later
            </Button>
            <Button onClick={() => void install(view.update)}>Restart and install</Button>
          </>
        )}
        {view.status === 'upToDate' && (
          <Button onClick={() => void dismissUpdate('later')}>Done</Button>
        )}
        {view.status === 'error' && (
          <>
            <Button variant="outline" onClick={() => void dismissUpdate('later')}>
              Decide later
            </Button>
            <Button onClick={retry}>Retry</Button>
          </>
        )}
      </footer>
    </main>
  );
}
