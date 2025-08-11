/**
 * Enhanced Data Layer - Unified API client with better error handling and type safety
 * Abstracts all API calls and provides consistent error handling patterns
 */

import { 
  WorkspaceListResponse, 
  WorkspaceInfo,
  CreateWorkspaceRequest,
  WorkspaceGraphResponse,
  NodeInfo,
  NodeDataResponse,
  FilterRequest,
  JoinRequest,
  CastRequest,
  SliceRequest,
  ConcordanceRequest,
  FileListResponse,
  AuthResponse,
  UploadProgress
} from '../types/api';

// API Configuration
const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? '/api' 
  : `http://localhost:8001/api`;

// Enhanced error class for API errors
export class APIError extends Error {
  public code?: string;
  public status?: number;
  public details?: any;

  constructor(message: string, code?: string, status?: number, details?: any) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// Request configuration interface
interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  onUploadProgress?: (progress: UploadProgress) => void;
}

/**
 * Enhanced API client with better error handling and type safety
 */
class APIClient {
  private baseURL: string;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  /**
   * Make HTTP request with enhanced error handling
   */
  private async request<T>(
    endpoint: string, 
    config: RequestConfig
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const controller = new AbortController();
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, config.timeout || this.defaultTimeout);

    try {
      const response = await fetch(url, {
        method: config.method,
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body: config.body ? JSON.stringify(config.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle HTTP errors
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorDetails = null;

        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.detail || errorMessage;
          errorDetails = errorData;
        } catch {
          // If JSON parsing fails, use the status text
        }

        throw new APIError(
          errorMessage,
          'HTTP_ERROR',
          response.status,
          errorDetails
        );
      }

      // Parse response
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return response.text() as T;
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof APIError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new APIError('Request timeout', 'TIMEOUT');
        }
        throw new APIError(error.message, 'NETWORK_ERROR');
      }

      throw new APIError('Unknown error occurred', 'UNKNOWN_ERROR');
    }
  }

  /**
   * Handle file upload with progress tracking
   */
  private async handleFileUpload(
    endpoint: string,
    file: File,
    additionalData?: Record<string, string>,
    headers?: Record<string, string>,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<any> {
    const url = `${this.baseURL}${endpoint}`;
    const formData = new FormData();
    formData.append('file', file);

    // Add any additional form data
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress: UploadProgress = {
              loaded: event.loaded,
              total: event.total,
              percent: Math.round((event.loaded / event.total) * 100),
            };
            onProgress(progress);
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          let errorMessage = `HTTP ${xhr.status}: ${xhr.statusText}`;
          try {
            const errorData = JSON.parse(xhr.responseText);
            errorMessage = errorData.message || errorData.detail || errorMessage;
          } catch {
            // Use status text if JSON parsing fails
          }
          reject(new APIError(errorMessage, 'HTTP_ERROR', xhr.status));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new APIError('Network error during file upload', 'NETWORK_ERROR'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new APIError('File upload timeout', 'TIMEOUT'));
      });

      xhr.open('POST', url);
      
      // Set headers (don't set Content-Type for FormData)
      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          if (key.toLowerCase() !== 'content-type') {
            xhr.setRequestHeader(key, value);
          }
        });
      }

      xhr.timeout = this.defaultTimeout;
      xhr.send(formData);
    });
  }

  // Authentication API
  async authenticateWithGoogle(idToken: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/google', {
      method: 'POST',
      body: { id_token: idToken },
    });
  }

  // Workspace API
  async getWorkspaces(headers: Record<string, string>): Promise<WorkspaceListResponse> {
    return this.request<WorkspaceListResponse>('/workspaces/', {
      method: 'GET',
      headers,
    });
  }

  async getCurrentWorkspace(headers: Record<string, string>): Promise<string | null> {
    const response = await this.request<{ current_workspace_id: string | null }>('/workspaces/current', {
      method: 'GET',
      headers,
    });
    return response.current_workspace_id;
  }

  async setCurrentWorkspace(workspaceId: string, headers: Record<string, string>): Promise<void> {
    await this.request<void>('/workspaces/current', {
      method: 'POST',
      headers,
      body: { workspace_id: workspaceId },
    });
  }

  async createWorkspace(request: CreateWorkspaceRequest, headers: Record<string, string>): Promise<WorkspaceInfo> {
    return this.request<WorkspaceInfo>('/workspaces/', {
      method: 'POST',
      headers,
      body: request,
    });
  }

  async deleteWorkspace(workspaceId: string, headers: Record<string, string>): Promise<void> {
    await this.request<void>(`/workspaces/${workspaceId}`, {
      method: 'DELETE',
      headers,
    });
  }

  async getWorkspaceGraph(workspaceId: string, headers: Record<string, string>): Promise<WorkspaceGraphResponse> {
    return this.request<WorkspaceGraphResponse>(`/workspaces/${workspaceId}/graph`, {
      method: 'GET',
      headers,
    });
  }

  // Node API
  async getNodeData(
    workspaceId: string, 
    nodeId: string, 
    page: number = 1, 
    pageSize: number = 20, 
    headers: Record<string, string>
  ): Promise<NodeDataResponse> {
    return this.request<NodeDataResponse>(`/workspaces/${workspaceId}/nodes/${nodeId}/data?page=${page}&page_size=${pageSize}`, {
      method: 'GET',
      headers,
    });
  }

  async getNodeSchema(workspaceId: string, nodeId: string, headers: Record<string, string>): Promise<Record<string, string>> {
    const response = await this.request<{ schema: Record<string, string> }>(`/workspaces/${workspaceId}/nodes/${nodeId}`, {
      method: 'GET',
      headers,
    });
    return response.schema;
  }

  async deleteNode(workspaceId: string, nodeId: string, headers: Record<string, string>): Promise<void> {
    await this.request<void>(`/workspaces/${workspaceId}/nodes/${nodeId}`, {
      method: 'DELETE',
      headers,
    });
  }

  async renameNode(workspaceId: string, nodeId: string, newName: string, headers: Record<string, string>): Promise<void> {
    await this.request<void>(`/workspaces/${workspaceId}/nodes/${nodeId}/name?new_name=${encodeURIComponent(newName)}`, {
      method: 'PUT',
      headers,
    });
  }

  // File API
  async getFiles(headers: Record<string, string>): Promise<FileListResponse> {
    return this.request<FileListResponse>('/files/', {
      method: 'GET',
      headers,
    });
  }

  async uploadFile(
    workspaceId: string,
    file: File,
    nodeName?: string,
    headers?: Record<string, string>,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<any> {
    const additionalData = nodeName ? { node_name: nodeName } : undefined;
    return this.handleFileUpload(`/workspaces/${workspaceId}/upload`, file, additionalData, headers, onProgress);
  }

  // Data Operation API
  async filterNode(
    workspaceId: string, 
    nodeId: string, 
    request: FilterRequest, 
    headers: Record<string, string>
  ): Promise<NodeInfo> {
    return this.request<NodeInfo>(`/workspaces/${workspaceId}/nodes/${nodeId}/filter`, {
      method: 'POST',
      headers,
      body: request,
    });
  }

  async joinNodes(
    workspaceId: string, 
    request: JoinRequest, 
    headers: Record<string, string>
  ): Promise<NodeInfo> {
    return this.request<NodeInfo>(`/workspaces/${workspaceId}/nodes/join`, {
      method: 'POST',
      headers,
      body: request,
    });
  }

  async castNode(
    workspaceId: string, 
    nodeId: string, 
    request: CastRequest, 
    headers: Record<string, string>
  ): Promise<NodeInfo> {
    return this.request<NodeInfo>(`/workspaces/${workspaceId}/nodes/${nodeId}/cast`, {
      method: 'POST',
      headers,
      body: request,
    });
  }

  async sliceNode(
    workspaceId: string, 
    nodeId: string, 
    request: SliceRequest, 
    headers: Record<string, string>
  ): Promise<NodeInfo> {
    return this.request<NodeInfo>(`/workspaces/${workspaceId}/nodes/${nodeId}/slice`, {
      method: 'POST',
      headers,
      body: request,
    });
  }

  async getConcordance(
    workspaceId: string, 
    nodeId: string, 
    request: ConcordanceRequest, 
    headers: Record<string, string>
  ): Promise<any> {
    return this.request<any>(`/workspaces/${workspaceId}/nodes/${nodeId}/concordance`, {
      method: 'POST',
      headers,
      body: request,
    });
  }
}

// Create singleton instance
export const apiClient = new APIClient();

// Export for testing
export { APIClient };
