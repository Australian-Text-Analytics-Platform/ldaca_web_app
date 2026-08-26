import { describe, expect, it, vi } from 'vitest';

import { buildBackendEventsUrl } from '../taskStreamUrl';

vi.mock('@/lib/backend/generatedClientConfig', () => ({
  getGeneratedApiBase: () => 'https://hub.test/user/example/proxy/3000',
}));

describe('buildBackendEventsUrl', () => {
  it('builds the single cookie-authenticated events endpoint without query credentials', () => {
    expect(buildBackendEventsUrl()).toBe('https://hub.test/user/example/proxy/3000/api/events');
  });
});
