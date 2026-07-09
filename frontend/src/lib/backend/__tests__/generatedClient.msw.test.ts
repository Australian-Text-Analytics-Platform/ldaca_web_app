import { describe, expect, it } from 'vitest';

import { getRuntimeConfig } from '@/api';
import { API_MOCK_ORIGIN } from '@/test/msw/handlers';

describe('generated client with MSW', () => {
  it('reads generated endpoint responses through the MSW test server', async () => {
    const { data } = await getRuntimeConfig({ baseUrl: API_MOCK_ORIGIN, throwOnError: true });

    expect(data).toMatchObject({
      multi_user_mode: false,
    });
  });
});
