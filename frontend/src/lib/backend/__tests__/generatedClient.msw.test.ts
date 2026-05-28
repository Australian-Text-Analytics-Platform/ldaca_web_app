import { describe, expect, it } from 'vitest';

import { getConfig } from '@/api/generated/sdk.gen';
import { API_MOCK_ORIGIN } from '@/test/msw/handlers';

describe('generated client with MSW', () => {
  it('reads generated endpoint responses through the MSW test server', async () => {
    const { data } = await getConfig({ baseUrl: API_MOCK_ORIGIN, throwOnError: true });

    expect(data).toMatchObject({
      data_root: '/tmp/ldaca-wordflow',
      multi_user_mode: false,
    });
  });
});
