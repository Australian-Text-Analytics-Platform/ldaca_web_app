import { describe, expect, it, vi } from 'vitest';

import { buildCilogonLoginUrl, buildGoogleLoginUri } from '../authRedirectUrls';

vi.mock('@/lib/backend/generatedClientConfig', () => ({
  getGeneratedApiBase: () => 'https://hub.test/user/example/proxy/3000',
}));

describe('auth redirect URL helpers', () => {
  it('builds the generated Google redirect login URI', () => {
    expect(buildGoogleLoginUri()).toBe(
      'https://hub.test/user/example/proxy/3000/api/auth/google/callback',
    );
  });

  it('builds the generated CILogon login URL', () => {
    expect(buildCilogonLoginUrl()).toBe(
      'https://hub.test/user/example/proxy/3000/api/auth/cilogon/login',
    );
  });
});
