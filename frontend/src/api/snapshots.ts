/**
 * REST client for ``/api/users/me/snapshots``.
 *
 * Mirrors the storage clerk responsibilities defined in
 * ``docs/snapshot-view/plan.md`` §2.5 — list, upload, download,
 * description, single delete, batch delete. The view-time
 * snapshot machinery lives in ``features/snapshot-view/``; this
 * file is the *transport* layer the capture/load UI calls into.
 */
import type { SnapshotManifest, SnapshotToolKey } from '@/features/snapshot-view';
import {
  batchDeleteSnapshotsApiUsersMeSnapshotsDelete,
  deleteSnapshotApiUsersMeSnapshotsFilenameDelete,
  downloadSnapshotApiUsersMeSnapshotsFilenameGet,
  getSnapshotDescriptionApiUsersMeSnapshotsFilenameDescriptionGet,
  listSnapshotsApiUsersMeSnapshotsGet,
  uploadSnapshotApiUsersMeSnapshotsPost,
} from './generated/sdk.gen';

export interface SnapshotListItem {
  filename: string;
  manifest: SnapshotManifest;
  /** On-disk bundle size in bytes. Used by the load dialog's size
   * pill alongside the version chip (plan §5.7.2). */
  size_bytes: number;
}

export interface SnapshotListResponse {
  items: SnapshotListItem[];
}

export interface SnapshotUploadResponse {
  filename: string;
  manifest: SnapshotManifest;
}

export interface SnapshotDeleteResponse {
  deleted: string[];
}

export const snapshotsApi = {
  /** List snapshots for the current user, optionally filtered by tool. */
  list: async (tool: SnapshotToolKey | undefined, headers: Record<string, string> = {}) => {
    const { data } = await listSnapshotsApiUsersMeSnapshotsGet({
      headers,
      query: tool ? { tool } : undefined,
      throwOnError: true,
    });
    return data as unknown as SnapshotListResponse;
  },

  /** Upload a bundle. The frontend should validate the filename and
   * collision before calling — the server re-checks defensively. */
  upload: async (
    bundle: Blob,
    filename: string,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await uploadSnapshotApiUsersMeSnapshotsPost({
      body: { file: bundle, filename },
      headers,
      throwOnError: true,
    });
    return data as unknown as SnapshotUploadResponse;
  },

  /** Download a bundle as a Blob. */
  download: async (filename: string, headers: Record<string, string> = {}) => {
    const { data } = await downloadSnapshotApiUsersMeSnapshotsFilenameGet({
      headers,
      parseAs: 'blob',
      path: { filename },
      throwOnError: true,
    });
    return data as Blob;
  },

  /** Fetch the human-readable .md description for a snapshot. */
  getDescription: async (filename: string, headers: Record<string, string> = {}) => {
    const { data } = await getSnapshotDescriptionApiUsersMeSnapshotsFilenameDescriptionGet({
      headers,
      parseAs: 'text',
      path: { filename },
      throwOnError: true,
    });
    return data as string;
  },

  /** Delete one snapshot (bundle + both sidecars). */
  deleteOne: async (filename: string, headers: Record<string, string> = {}) => {
    const { data } = await deleteSnapshotApiUsersMeSnapshotsFilenameDelete({
      headers,
      path: { filename },
      throwOnError: true,
    });
    return data as unknown as SnapshotDeleteResponse;
  },

  /** Batch delete for a tool. Without ``incompatibleWith``, deletes
   * every snapshot for the tool. With it, deletes only those whose
   * tool_version is incompatible per MAJOR.MINOR (server-side check). */
  deleteBatch: (
    tool: SnapshotToolKey,
    incompatibleWith: string | undefined,
    headers: Record<string, string> = {},
  ) => {
    return batchDeleteSnapshotsApiUsersMeSnapshotsDelete({
      headers,
      query: { tool, incompatible_with: incompatibleWith ?? null },
      throwOnError: true,
    }).then(({ data }) => data as unknown as SnapshotDeleteResponse);
  },
};
