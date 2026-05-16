/**
 * REST client for ``/api/users/me/snapshots``.
 *
 * Mirrors the storage clerk responsibilities defined in
 * ``docs/snapshot-view/plan.md`` §2.5 — list, upload, download,
 * description, single delete, batch delete. The view-time
 * snapshot machinery lives in ``features/snapshot-view/``; this
 * file is the *transport* layer the capture/load UI calls into.
 */
import { del, get, httpRequest } from './http';
import type { SnapshotManifest, SnapshotToolKey } from '@/features/snapshot-view';

export interface SnapshotListItem {
  filename: string;
  manifest: SnapshotManifest;
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
  list: (tool: SnapshotToolKey | undefined, headers: Record<string, string> = {}) =>
    get<SnapshotListResponse>(
      '/users/me/snapshots',
      headers,
      tool ? { tool } : undefined,
    ),

  /** Upload a bundle. The frontend should validate the filename and
   * collision before calling — the server re-checks defensively. */
  upload: (
    bundle: Blob,
    filename: string,
    headers: Record<string, string> = {},
  ) => {
    const formData = new FormData();
    formData.append('file', bundle, filename);
    formData.append('filename', filename);
    return httpRequest<SnapshotUploadResponse>('/users/me/snapshots', {
      method: 'POST',
      formData,
      headers,
    });
  },

  /** Download a bundle as a Blob. */
  download: (filename: string, headers: Record<string, string> = {}) =>
    httpRequest<Blob>(`/users/me/snapshots/${encodeURIComponent(filename)}`, {
      method: 'GET',
      headers,
      expectBlob: true,
    }),

  /** Fetch the human-readable .md description for a snapshot. */
  getDescription: (filename: string, headers: Record<string, string> = {}) =>
    httpRequest<string>(
      `/users/me/snapshots/${encodeURIComponent(filename)}/description`,
      { method: 'GET', headers },
    ),

  /** Delete one snapshot (bundle + both sidecars). */
  deleteOne: (filename: string, headers: Record<string, string> = {}) =>
    del<SnapshotDeleteResponse>(
      `/users/me/snapshots/${encodeURIComponent(filename)}`,
      headers,
    ),

  /** Batch delete for a tool. Without ``incompatibleWith``, deletes
   * every snapshot for the tool. With it, deletes only those whose
   * tool_version is incompatible per MAJOR.MINOR (server-side check). */
  deleteBatch: (
    tool: SnapshotToolKey,
    incompatibleWith: string | undefined,
    headers: Record<string, string> = {},
  ) => {
    const params: Record<string, string> = { tool };
    if (incompatibleWith) params.incompatible_with = incompatibleWith;
    return del<SnapshotDeleteResponse>('/users/me/snapshots', headers, params);
  },
};
