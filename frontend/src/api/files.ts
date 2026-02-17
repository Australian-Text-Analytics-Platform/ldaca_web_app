import { get, post, del, httpRequest } from './http';

export interface FileInfo {
  filename: string;
  display_name: string;
  folder: string;
  size: number;
  created_at: number;
  file_type: string;
  readme?: string | null;
  modified?: string;
  type?: string;
}

export interface FileListResponse {
  files: FileInfo[];
  total: number;
  user_folder: string;
}

export interface UnifiedFilePreviewRequest {
  filename: string;
  page?: number;
  page_size?: number;
  payload?: { sheet_name?: string };
}

export interface FilesTaskItem {
  task_id: string;
  state: string;
  task_type?: string;
  progress?: number;
  progress_message?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface FilesTaskListResponse {
  state: string;
  data: FilesTaskItem[];
  message: string;
}

export interface LdacaImportStartResponse {
  state: 'running';
  message: string;
  metadata: {
    task_id: string;
    task_scope?: string;
  };
}

export const filesApi = {
  list: (headers: Record<string,string> = {}) => get<FileListResponse>('/files/', headers),
  upload: (file: File, headers: Record<string,string> = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    return httpRequest('/files/upload', { method: 'POST', formData, headers });
  },
  download: (fileName: string, headers: Record<string,string> = {}) => httpRequest(`/files/${encodeURIComponent(fileName)}`, { method: 'GET', headers, expectBlob: true }),
  preview: (body: UnifiedFilePreviewRequest, headers: Record<string,string> = {}) => post('/files/preview', body, headers),
  info: (fileName: string, headers: Record<string,string> = {}) => get(`/files/${encodeURIComponent(fileName)}/info`, headers),
  delete: (fileName: string, headers: Record<string,string> = {}) => del(`/files/${encodeURIComponent(fileName)}`, headers),
  importSampleData: (headers: Record<string,string> = {}) => post('/files/import-sample-data', {}, headers),
  importLdaca: (url: string, headers: Record<string,string> = {}) =>
    post<LdacaImportStartResponse>('/files/import-ldaca', { url }, headers),
  listTasks: (headers: Record<string,string> = {}) => get<FilesTaskListResponse>('/files/tasks', headers),
  cancelTasks: (payload: { task_type?: string; task_id?: string } = {}, headers: Record<string,string> = {}) =>
    post('/files/tasks/cancel', payload, headers),
  clearTasks: (payload: { task_type?: string; task_id?: string } = {}, headers: Record<string,string> = {}) =>
    post('/files/tasks/clear', payload, headers),
};
