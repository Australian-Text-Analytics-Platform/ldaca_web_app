import { get, post, del, httpRequest } from './http';

export interface FileTreeFile {
  name: string;
  path: string;
  type: 'file';
  size: number;
}

export interface FileTreeDirectory {
  name: string;
  path: string;
  type: 'directory';
  children: FileTreeNode[];
}

export type FileTreeNode = FileTreeFile | FileTreeDirectory;

export interface CreateFolderResponse {
  message: string;
  path: string;
}

export interface MoveFileResponse {
  message: string;
  path: string;
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

export interface LdacaImportStartResponse {
  state: 'running';
  message: string;
  metadata: {
    task_id: string;
  };
}

export const filesApi = {
  list: (headers: Record<string, string> = {}) =>
    get<FileTreeNode[]>('/files/', headers),

  raw: (path: string, headers: Record<string, string> = {}) =>
    get<string>('/files/raw', headers, { path }),

  createFolder: (parentPath: string, name: string, headers: Record<string, string> = {}) =>
    post<CreateFolderResponse>('/files/folders', { parent_path: parentPath, name }, headers),

  moveFile: (sourcePath: string, targetDirectoryPath: string, headers: Record<string, string> = {}) =>
    post<MoveFileResponse>(
      '/files/move',
      { source_path: sourcePath, target_directory_path: targetDirectoryPath },
      headers,
    ),

  upload: (file: File, headers: Record<string, string> = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    return httpRequest<Record<string, unknown>>('/files/upload', {
      method: 'POST',
      formData,
      headers,
    });
  },

  download: (fileName: string, headers: Record<string, string> = {}) =>
    httpRequest<Blob>(`/files/${encodeURIComponent(fileName)}`, {
      method: 'GET',
      headers,
      expectBlob: true,
    }),

  preview: (body: UnifiedFilePreviewRequest, headers: Record<string, string> = {}) =>
    post<FilePreviewResponse>('/files/preview', body, headers),

  delete: (fileName: string, headers: Record<string, string> = {}) =>
    del<Record<string, unknown>>(`/files/${encodeURIComponent(fileName)}`, headers),

  importSampleData: (headers: Record<string, string> = {}) =>
    post<Record<string, unknown>>('/files/import-sample-data', {}, headers),

  importLdaca: (url: string, headers: Record<string, string> = {}) =>
    post<LdacaImportStartResponse>('/files/import-ldaca', { url }, headers),

  /** Clear a single background task tracked under /files/tasks. */
  clearTasks: (
    payload: { task_type?: string; task_id?: string } = {},
    headers: Record<string, string> = {},
  ) => post<Record<string, unknown>>('/files/tasks/clear', payload, headers),
};
