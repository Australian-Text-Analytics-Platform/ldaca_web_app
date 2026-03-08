import { get, post, del, httpRequest } from './http';
import type { WorkspaceInfo, WorkspaceGraphResponse } from '../types/api';

export const workspacesApi = {
  list: (headers: Record<string,string> = {}) => get<WorkspaceInfo[]>('/workspaces/', headers),
  create: (name: string, description = '', headers: Record<string,string> = {}) => post<Record<string, unknown>>('/workspaces/', { name, description }, headers),
  info: (id: string, headers: Record<string,string> = {}) => get<Record<string, unknown>>(`/workspaces/info`, headers),
  delete: (id: string, headers: Record<string,string> = {}) => del<Record<string, unknown>>(`/workspaces/delete`, headers, { workspace_id: id }),
  uploadZip: (file: File, headers: Record<string,string> = {}) => { const fd = new FormData(); fd.append('file', file); return httpRequest<Record<string, unknown>>('/workspaces/upload', { method: 'POST', formData: fd, headers }); },
  downloadZip: (headers: Record<string,string> = {}) => httpRequest<Blob>(`/workspaces/download`, { method: 'GET', headers, expectBlob: true }),
  startDownloadTask: (headers: Record<string,string> = {}) => post<{ state: string; message: string; metadata: { task_id: string } }>(`/workspaces/download`, {}, headers),
  downloadTaskArtifact: (taskId: string, headers: Record<string,string> = {}) => httpRequest<Blob>(`/workspaces/download/tasks/${taskId}/artifact`, { method: 'GET', headers, expectBlob: true }),
  nodes: (headers: Record<string,string> = {}) => get<Record<string, unknown>>(`/workspaces/nodes`, headers).then(r => (r as Record<string, unknown>).nodes || r),
  graph: (headers: Record<string,string> = {}) => get<WorkspaceGraphResponse>(`/workspaces/graph`, headers),
  save: (headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/save`, {}, headers),
  saveAs: (filename: string, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/save-as`, {}, headers, { filename }),
  updateName: (newName: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/name`, { method: 'PUT', headers, params: { new_name: newName } }),
  clearAnalysis: (task?: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/analysis/clear`, { method: 'POST', headers, params: task ? { task } : {} }),
  listTasks: (headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/tasks`, { method: 'GET', headers }),
  clearTokenFrequencies: (headers: Record<string, string> = {}) =>
      httpRequest<Record<string, unknown>>(`/workspaces/token-frequencies`, {
      method: 'DELETE',
      headers,
    }),
  
  clearTasks: (
    options: { task_id: string },
    headers: Record<string,string> = {}
  ) => httpRequest<Record<string, unknown>>(`/tasks/clear`, { method: 'POST', headers, params: options }),
  current: {
    get: (headers: Record<string,string> = {}) => get<{ id: string|null }>('/workspaces/current', headers).then(r => r.id),
    set: (workspaceId: string | null, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/current${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, { method: 'POST', headers }),
  }
};
