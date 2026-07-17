import { describe, expect, it, vi } from 'vitest';

import { buildBackendEventsUrl } from '../taskStreamUrl';

vi.mock('@/lib/backend/generatedClientConfig', () => ({
  getGeneratedApiBase: () => 'http://api.test',
}));

describe('buildBackendEventsUrl', () => {
  it('builds the single cookie-authenticated events endpoint without query credentials', () => {
    expect(buildBackendEventsUrl()).toBe('http://api.test/api/events');
  });
});
