import { http, HttpResponse } from 'msw';

import { configResponse, preferencesResponse } from './fixtures';

export const API_MOCK_ORIGIN = 'http://api.test';

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_MOCK_ORIGIN}/api${normalizedPath}`;
};

export const apiPath = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `*/api${normalizedPath}`;
};

export const handlers = [
  http.get(apiPath('/config/'), () => HttpResponse.json(configResponse())),
  http.get(apiPath('/preferences/'), () => HttpResponse.json(preferencesResponse())),
];