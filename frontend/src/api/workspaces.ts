import { get, post, del, httpRequest } from './http';

export const workspacesApi = {
  list: (headers: Record<string,string> = {}) => get<any>('/workspaces/', headers).then(r => r.workspaces || r),
  create: (name: string, description = '', headers: Record<string,string> = {}) => post('/workspaces/', { name, description }, headers),
  info: (id: string, headers: Record<string,string> = {}) => get(`/workspaces/${id}`, headers),
  delete: (id: string, headers: Record<string,string> = {}) => del(`/workspaces/${id}`, headers),
  import: (file: File, headers: Record<string,string> = {}) => { const fd = new FormData(); fd.append('file', file); return httpRequest('/workspaces/import', { method: 'POST', formData: fd, headers }); },
  nodes: (id: string, headers: Record<string,string> = {}) => get<any>(`/workspaces/${id}/nodes`, headers).then(r => r.nodes || r),
  graph: (id: string, headers: Record<string,string> = {}) => get(`/workspaces/${id}/graph`, headers),
  save: (id: string, headers: Record<string,string> = {}) => post(`/workspaces/${id}/save`, {}, headers),
  saveAs: (id: string, filename: string, headers: Record<string,string> = {}) => post(`/workspaces/${id}/save-as`, {}, headers, { filename }),
  updateName: (id: string, newName: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${id}/name`, { method: 'PUT', headers, params: { new_name: newName } }),
  clearAnalysis: (id: string, task?: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${id}/analysis/clear`, { method: 'POST', headers, params: task ? { task } : {} }),
  listTasks: (id: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${id}/tasks`, { method: 'GET', headers }),
  cancelTasks: (id: string, options?: { task_id?: string }, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${id}/tasks/cancel`, { method: 'POST', headers, params: options || {} }),
  clearTasks: (id: string, options?: { task_id?: string }, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${id}/tasks/clear`, { method: 'POST', headers, params: options || {} }),
  current: {
    get: (headers: Record<string,string> = {}) => get<{ current_workspace_id: string|null }>('/workspaces/current', headers).then(r => r.current_workspace_id),
    set: (workspaceId: string | null, headers: Record<string,string> = {}) => httpRequest(`/workspaces/current${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, { method: 'POST', headers }),
  }
};
