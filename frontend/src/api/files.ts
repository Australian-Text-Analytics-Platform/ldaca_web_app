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

export interface FilePreviewResponse {
  preview: Record<string, unknown>[];
  columns: string[];
  total_rows: number;
  file_type: string | null;
  sheet_names: string[] | null;
  supported_types: string[];
  selected_sheet: string | null;
}

export interface FilesTaskItem {
  task_id: string;
  state: string;
  task_type?: string;
  name?: string;
  user_id?: string;
  workspace_id?: string;
  progress?: number;
  progress_message?: string;
  message?: string;
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
  };
}

export const filesApi = {
  list: (headers: Record<string,string> = {}) => get<FileListResponse>('/files/', headers),
  upload: (file: File, headers: Record<string,string> = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    return httpRequest<Record<string, unknown>>('/files/upload', { method: 'POST', formData, headers });
  },
  download: (fileName: string, headers: Record<string,string> = {}) => httpRequest<Blob>(`/files/${encodeURIComponent(fileName)}`, { method: 'GET', headers, expectBlob: true }),
  preview: (body: UnifiedFilePreviewRequest, headers: Record<string,string> = {}) => post<FilePreviewResponse>('/files/preview', body, headers),
  info: (fileName: string, headers: Record<string,string> = {}) => get<Record<string, unknown>>(`/files/${encodeURIComponent(fileName)}/info`, headers),
  delete: (fileName: string, headers: Record<string,string> = {}) => del<Record<string, unknown>>(`/files/${encodeURIComponent(fileName)}`, headers),
  importSampleData: (headers: Record<string,string> = {}) => post<Record<string, unknown>>('/files/import-sample-data', {}, headers),
  importLdaca: (url: string, headers: Record<string,string> = {}) =>
    post<LdacaImportStartResponse>('/files/import-ldaca', { url }, headers),
  listTasks: (headers: Record<string,string> = {}) => get<FilesTaskListResponse>('/files/tasks', headers),
  clearTasks: (payload: { task_type?: string; task_id?: string } = {}, headers: Record<string,string> = {}) =>
    post<Record<string, unknown>>('/files/tasks/clear', payload, headers),
};
