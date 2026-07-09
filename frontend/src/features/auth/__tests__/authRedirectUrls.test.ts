import { describe, expect, it, vi } from 'vitest';

import { buildCilogonLoginUrl, buildGoogleLoginUri } from '../authRedirectUrls';

vi.mock('@/lib/backend/generatedClientConfig', () => ({
  getGeneratedApiBase: () => 'http://api.test',
}));

describe('auth redirect URL helpers', () => {
  it('builds the generated Google redirect login URI', () => {
    expect(buildGoogleLoginUri()).toBe('http://api.test/api/auth/google/callback');
  });

  it('builds the generated CILogon login URL', () => {
    expect(buildCilogonLoginUrl()).toBe('http://api.test/api/auth/cilogon/login');
  });
});
