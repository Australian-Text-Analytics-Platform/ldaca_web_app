import { useWorkspaceTaskInbox } from '@/features/workspace/task-stream/useWorkspaceTaskInbox';
import type {
  TaskStreamState as WorkspaceTaskStreamState,
  WorkspaceTaskStreamClientState,
} from '@/features/workspace/task-stream/useWorkspaceTaskStreamClient';

export type TaskStreamState = WorkspaceTaskStreamState;
export type UseWorkspaceTaskStreamResult = WorkspaceTaskStreamClientState;

export const useWorkspaceTaskStream = (
  workspaceId: string | null
): WorkspaceTaskStreamClientState => useWorkspaceTaskInbox(workspaceId);

export default useWorkspaceTaskStream;
