import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { configApi } from '@/lib/backend/config';
import { preferencesApi } from '@/lib/backend/preferences';
import { apiPath } from '@/test/msw/handlers';
import { configResponse, preferencesResponse } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';

describe('generated API adapters', () => {
  it('keeps configApi shape while using the generated client', async () => {
    await expect(configApi.getConfig()).resolves.toMatchObject({
      data_root: '/tmp/ldaca-wordflow',
      multi_user_mode: false,
    });

    server.use(
      http.post(apiPath('/config/'), async ({ request }) => {
        await expect(request.json()).resolves.toEqual({ data_root: '/new-root' });
        return HttpResponse.json(configResponse({ data_root: '/new-root', multi_user_mode: true }));
      }),
    );

    await expect(configApi.updateConfig({ data_root: '/new-root' })).resolves.toMatchObject({
      data_root: '/new-root',
      multi_user_mode: true,
    });
  });

  it('passes auth headers and normalizes preferencesApi responses', async () => {
    server.use(
      http.get(apiPath('/preferences/'), ({ request }) => {
        expect(request.headers.get('Authorization')).toBe('Bearer explicit-token');
        return HttpResponse.json(preferencesResponse({ default_language: 'zh' }));
      }),
    );

    await expect(preferencesApi.get({ Authorization: 'Bearer explicit-token' })).resolves.toMatchObject({
      default_language: 'zh',
      quotation: {
        engine: { type: 'local' },
        last_remote_url: '',
      },
    });
  });
});