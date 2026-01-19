import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/http';
import { getInvalidWorkspaceNameMessage } from './workspaceName';

describe('getInvalidWorkspaceNameMessage', () => {
  it('returns message for invalid workspace name errors', () => {
    const error = new ApiError('Invalid workspace name: "/" is not allowed');
    expect(getInvalidWorkspaceNameMessage(error)).toBe('Invalid workspace name: "/" is not allowed');
  });

  it('returns null for other errors', () => {
    expect(getInvalidWorkspaceNameMessage(new Error('nope'))).toBeNull();
  });
});
