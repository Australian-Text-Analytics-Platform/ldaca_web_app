import { http, HttpResponse } from 'msw';

import { configResponse, preferencesResponse } from './fixtures';

export const API_MOCK_ORIGIN = 'http://api.test';

/** Called by: the shared MSW handler definitions in this module because the caller needs one documented boundary for the lookup, event, or state handoff step. */
const apiPath = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `*/api${normalizedPath}`;
};

export const handlers = [
  http.get(apiPath('/config/'), () => HttpResponse.json(configResponse())),
  http.get(apiPath('/preferences/'), () => HttpResponse.json(preferencesResponse())),
];