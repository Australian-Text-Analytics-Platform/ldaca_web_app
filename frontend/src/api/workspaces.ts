import { get, post, del, httpRequest } from './http';

export const workspacesApi = {
  list: (headers: Record<string,string> = {}) => get<any>('/workspaces/', headers).then(r => r.workspaces || r),
  create: (name: string, description = '', headers: Record<string,string> = {}) => post('/workspaces/', { name, description }, headers),
  info: (id: string, headers: Record<string,string> = {}) => get(`/workspaces/info`, headers),
  delete: (id: string, headers: Record<string,string> = {}) => del(`/workspaces/delete`, headers),
  uploadZip: (file: File, headers: Record<string,string> = {}) => { const fd = new FormData(); fd.append('file', file); return httpRequest('/workspaces/upload', { method: 'POST', formData: fd, headers }); },
  downloadZip: (headers: Record<string,string> = {}) => httpRequest<Blob>(`/workspaces/download`, { method: 'GET', headers, expectBlob: true }),
  startDownloadTask: (headers: Record<string,string> = {}) => post<{ state: string; message: string; metadata: { task_id: string; task_scope: string } }>(`/workspaces/download`, {}, headers),
  downloadTaskArtifact: (taskId: string, headers: Record<string,string> = {}) => httpRequest<Blob>(`/workspaces/download/tasks/${taskId}/artifact`, { method: 'GET', headers, expectBlob: true }),
  nodes: (headers: Record<string,string> = {}) => get<any>(`/workspaces/nodes`, headers).then(r => r.nodes || r),
  graph: (headers: Record<string,string> = {}) => get(`/workspaces/graph`, headers),
  save: (headers: Record<string,string> = {}) => post(`/workspaces/save`, {}, headers),
  saveAs: (filename: string, headers: Record<string,string> = {}) => post(`/workspaces/save-as`, {}, headers, { filename }),
  updateName: (newName: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/name`, { method: 'PUT', headers, params: { new_name: newName } }),
  clearAnalysis: (task?: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/analysis/clear`, { method: 'POST', headers, params: task ? { task } : {} }),
  listTasks: (headers: Record<string,string> = {}) => httpRequest(`/workspaces/tasks`, { method: 'GET', headers }),
  cancelTasks: (options?: { task_id?: string }, headers: Record<string,string> = {}) => httpRequest(`/workspaces/tasks/cancel`, { method: 'POST', headers, params: options || {} }),
  clearTasks: (options?: { task_id?: string }, headers: Record<string,string> = {}) => httpRequest(`/workspaces/tasks/clear`, { method: 'POST', headers, params: options || {} }),
  current: {
    get: (headers: Record<string,string> = {}) => get<{ id: string|null }>('/workspaces/current', headers).then(r => r.id),
    set: (workspaceId: string | null, headers: Record<string,string> = {}) => httpRequest(`/workspaces/current${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, { method: 'POST', headers }),
  }
};
