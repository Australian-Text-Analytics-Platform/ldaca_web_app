import {
  cancelTaskApiTasksCancelPost,
  clearTasksApiTasksClearPost,
  createWorkspaceApiWorkspacesPost,
  deleteWorkspaceApiWorkspacesDeleteDelete,
  downloadWorkspaceArtifactApiWorkspacesDownloadTasksTaskIdArtifactGet,
  getCurrentWorkspaceApiWorkspacesCurrentGet,
  getWorkspaceGraphApiWorkspacesGraphGet,
  listWorkspacesApiWorkspacesGet,
  renameWorkspaceApiWorkspacesNamePut,
  saveWorkspaceApiWorkspacesSavePost,
  setCurrentWorkspaceApiWorkspacesCurrentPost,
  startWorkspaceDownloadApiWorkspacesDownloadPost,
  updateWorkspaceDescriptionApiWorkspacesDescriptionPut,
  uploadWorkspaceZipApiWorkspacesUploadPost,
} from '@/api/generated/sdk.gen';
import type { WorkspaceInfo, WorkspaceGraphResponse } from '@/types/api';
import { ApiError } from '@/lib/apiError';

export const workspacesApi = {
  list: async (headers: Record<string, string> = {}): Promise<WorkspaceInfo[]> => {
    const { data } = await listWorkspacesApiWorkspacesGet({ headers, throwOnError: true });
    return data as WorkspaceInfo[];
  },

  create: async (name: string, description = '', headers: Record<string, string> = {}) => {
    const { data } = await createWorkspaceApiWorkspacesPost({
      body: { name, description },
      headers,
      throwOnError: true,
    });
    return data;
  },

  delete: async (id: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> => {
    const { data } = await deleteWorkspaceApiWorkspacesDeleteDelete({
      headers,
      query: { workspace_id: id },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  uploadZip: async (file: File, headers: Record<string, string> = {}) => {
    const { data } = await uploadWorkspaceZipApiWorkspacesUploadPost({
      body: { file },
      headers,
      throwOnError: true,
    });
    return data;
  },

  startDownloadTask: async (headers: Record<string, string> = {}) => {
    const { data } = await startWorkspaceDownloadApiWorkspacesDownloadPost({
      headers,
      throwOnError: true,
    });
    return data as { state: string; message: string; metadata: { task_id: string } };
  },

  downloadTaskArtifact: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await downloadWorkspaceArtifactApiWorkspacesDownloadTasksTaskIdArtifactGet({
      headers,
      parseAs: 'blob',
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Blob;
  },

  graph: async (headers: Record<string, string> = {}): Promise<WorkspaceGraphResponse> => {
    const { data } = await getWorkspaceGraphApiWorkspacesGraphGet({ headers, throwOnError: true });
    return data as WorkspaceGraphResponse;
  },

  save: async (headers: Record<string, string> = {}) => {
    const { data } = await saveWorkspaceApiWorkspacesSavePost({ headers, throwOnError: true });
    return data;
  },

  updateName: async (newName: string, headers: Record<string, string> = {}) => {
    const { data } = await renameWorkspaceApiWorkspacesNamePut({
      headers,
      query: { new_name: newName },
      throwOnError: true,
    });
    return data;
  },

  updateDescription: async (description: string, headers: Record<string, string> = {}) => {
    const { data } = await updateWorkspaceDescriptionApiWorkspacesDescriptionPut({
      headers,
      query: { description },
      throwOnError: true,
    });
    return data;
  },

  clearTasks: async (options: { task_id: string }, headers: Record<string, string> = {}) => {
    const { data } = await clearTasksApiTasksClearPost({
      headers,
      query: options,
      throwOnError: true,
    });
    return data;
  },

  cancelTask: async (options: { task_id: string }, headers: Record<string, string> = {}) => {
    const { data } = await cancelTaskApiTasksCancelPost({
      headers,
      query: options,
      throwOnError: true,
    });
    return data;
  },

  current: {
    get: async (headers: Record<string, string> = {}) => {
      const { data } = await getCurrentWorkspaceApiWorkspacesCurrentGet({ headers, throwOnError: true });
      return (data as { id?: string | null }).id ?? null;
    },
    set: async (workspaceId: string | null, headers: Record<string, string> = {}) => {
      const setCurrentWorkspace = () =>
        setCurrentWorkspaceApiWorkspacesCurrentPost({
          headers,
          query: workspaceId === null ? undefined : { workspace_id: workspaceId },
          throwOnError: true,
        });

      try {
        const { data } = await setCurrentWorkspace();
        return data as Record<string, unknown>;
      } catch (error) {
        const shouldRefreshAndRetry =
          workspaceId !== null &&
          error instanceof ApiError &&
          error.status === 404;

        if (!shouldRefreshAndRetry) {
          throw error;
        }

        await listWorkspacesApiWorkspacesGet({ headers, throwOnError: true });
        const { data } = await setCurrentWorkspace();
        return data as Record<string, unknown>;
      }
    },
  },
};
