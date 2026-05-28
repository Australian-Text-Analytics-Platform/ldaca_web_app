/**
 * Unified download helper that emits user-visible toast notifications and,
 * when running inside the Tauri desktop app, writes blobs to the system
 * Downloads folder (because Tauri's webview does not surface a download
 * progress UI like a regular browser does).
 *
 * Browser/web: falls back to the standard `<a download>` mechanism so the
 * browser's own download UI handles progress and the destination folder.
 */
import { toast } from 'sonner';
import { isTauri } from '@/lib/isTauri';

/**
 * Append a numeric suffix before the extension if `filename` already exists
 * in the Downloads directory: `report.csv` → `report (1).csv`.
 *
 * Lookups use the `fs` plugin's `exists` command (download scope, recursive).
 * Caps attempts at 1000 to avoid pathological loops.
 */
/**
 * Called by: saveBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const resolveUniqueFilename = async (
  filename: string,
  exists: (path: string, opts: { baseDir: number }) => Promise<boolean>,
  baseDir: number,
): Promise<string> => {
  if (!(await exists(filename, { baseDir }))) return filename;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await exists(candidate, { baseDir }))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
};

/** Uses native browser download UI for web builds where destination/progress are already visible. */
/**
 * Called by: saveBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const browserDownload = (blob: Blob, filename: string) => {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    window.setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }
};

/**
 * Reduce a path-like filename to its basename. The backend may return paths
 * with slashes (e.g. `sample_data/ADO/reddit/reddit_comments.csv`); browsers
 * strip these for `<a download>`, but Tauri's `writeFile` would interpret
 * them as nested directories under Downloads (which don't exist) and fail.
 */
/** Called by: saveBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const toBasename = (filename: string): string => {
  const trimmed = filename.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
};

/** Writes bytes through Tauri plugins so desktop users get a real file in Downloads. */
/**
 * Called by: saveBlob in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
const tauriDownload = async (blob: Blob, filename: string) => {
  // Dynamic imports keep these out of browser bundles.
  const [{ writeFile, exists, BaseDirectory }, { downloadDir, join }, opener] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-opener'),
  ]);

  const finalName = await resolveUniqueFilename(
    toBasename(filename),
    exists as (p: string, o: { baseDir: number }) => Promise<boolean>,
    BaseDirectory.Download,
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(finalName, bytes, { baseDir: BaseDirectory.Download });

  const fullPath = await join(await downloadDir(), finalName);
  return { fullPath, opener };
};

export interface SaveBlobOptions {
  /** When true, suppress toasts even in Tauri (e.g. for caller-controlled flows). */
  silent?: boolean;
}

/**
 * Save a blob, notifying the user where it landed. In Tauri we write the file
 * to the OS Downloads folder and surface a toast (with a "Show in folder"
 * action) because the desktop webview has no built-in download UI. In regular
 * browsers we delegate to the native `<a download>` mechanism, which already
 * shows progress and the destination in the browser chrome — no toast needed.
 */
/**
 * Used by: src/features/analysis/export/ExportFeature.tsx, src/features/analysis/token-frequency/tokenFrequencyExport.ts, src/features/analysis/topic-modeling/components/results/TopicModelingBubbleChartSection.tsx and 3 other importers because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export const saveBlob = async (
  blob: Blob,
  filename: string,
  options: SaveBlobOptions = {},
): Promise<void> => {
  const { silent = false } = options;

  if (!isTauri()) {
    browserDownload(blob, filename);
    return;
  }

  try {
    const { fullPath, opener } = await tauriDownload(blob, filename);
    if (!silent) {
      toast.success(`Saved ${toBasename(filename)} to your Downloads folder`, {
        description: fullPath,
        action: {
          label: 'Show in folder',
          /** Lets desktop users reveal the saved file from the success toast action. */
          /** Used by: the toast action onClick handler in this module because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
          onClick: () => {
            void opener.revealItemInDir(fullPath).catch(() => {
              // Reveal failures are non-fatal — the file still exists.
            });
          },
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (!silent) {
      toast.error(`Failed to download ${toBasename(filename)}`, { description: message });
    }
    throw error;
  }
};
