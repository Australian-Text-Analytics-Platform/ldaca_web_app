import { get, post, del, httpRequest } from './http';
import type { WorkspaceInfo, WorkspaceGraphResponse } from '../types/api';

export const workspacesApi = {
  list: (headers: Record<string, string> = {}) =>
    get<WorkspaceInfo[]>('/workspaces/', headers),

  create: (name: string, description = '', headers: Record<string, string> = {}) =>
    post<Record<string, unknown>>('/workspaces/', { name, description }, headers),

  delete: (id: string, headers: Record<string, string> = {}) =>
    del<Record<string, unknown>>('/workspaces/delete', headers, { workspace_id: id }),

  uploadZip: (file: File, headers: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    return httpRequest<Record<string, unknown>>('/workspaces/upload', {
      method: 'POST',
      formData: fd,
      headers,
    });
  },

  startDownloadTask: (headers: Record<string, string> = {}) =>
    post<{ state: string; message: string; metadata: { task_id: string } }>(
      '/workspaces/download',
      {},
      headers,
    ),

  downloadTaskArtifact: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Blob>(`/workspaces/download/tasks/${taskId}/artifact`, {
      method: 'GET',
      headers,
      expectBlob: true,
    }),

  graph: (headers: Record<string, string> = {}) =>
    get<WorkspaceGraphResponse>('/workspaces/graph', headers),

  save: (headers: Record<string, string> = {}) =>
    post<Record<string, unknown>>('/workspaces/save', {}, headers),

  updateName: (newName: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>('/workspaces/name', {
      method: 'PUT',
      headers,
      params: { new_name: newName },
    }),

  updateDescription: (description: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>('/workspaces/description', {
      method: 'PUT',
      headers,
      params: { description },
    }),

  /** Clear a single task artifact (alias endpoint under /tasks/clear). */
  clearTasks: (options: { task_id: string }, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>('/tasks/clear', {
      method: 'POST',
      headers,
      params: options,
    }),

  /** Current (active) workspace id accessors. */
  current: {
    get: (headers: Record<string, string> = {}) =>
      get<{ id: string | null }>('/workspaces/current', headers).then(r => r.id),
    set: (workspaceId: string | null, headers: Record<string, string> = {}) => {
      const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
      return httpRequest<Record<string, unknown>>(`/workspaces/current${qs}`, {
        method: 'POST',
        headers,
      });
    },
  },
};
