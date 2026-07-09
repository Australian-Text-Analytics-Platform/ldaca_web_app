import { describe, expect, it, vi } from 'vitest';

import { buildTaskStreamUrl } from '../taskStreamUrl';

vi.mock('@/lib/backend/generatedClientConfig', () => ({
  getGeneratedApiBase: () => 'http://api.test',
}));

describe('buildTaskStreamUrl', () => {
  it('builds the generated task stream endpoint without auth query when no token exists', () => {
    expect(buildTaskStreamUrl({})).toBe('http://api.test/api/tasks/stream');
  });

  it('serializes bearer auth as the generated token query parameter', () => {
    expect(buildTaskStreamUrl({ Authorization: 'Bearer tok 1' })).toBe(
      'http://api.test/api/tasks/stream?token=tok+1',
    );
  });

  it('accepts lowercase authorization headers from auth callers', () => {
    expect(buildTaskStreamUrl({ authorization: 'Bearer token-2' })).toBe(
      'http://api.test/api/tasks/stream?token=token-2',
    );
  });
});
