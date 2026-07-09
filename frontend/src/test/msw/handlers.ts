import { http, HttpResponse } from 'msw';

import { configResponse, nodeDataResponse, preferencesResponse } from './fixtures';

export const API_MOCK_ORIGIN = 'http://api.test';

/** Called by: the shared MSW handler definitions in this module because the caller needs one documented boundary for the lookup, event, or state handoff step. */
const apiPath = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `*/api${normalizedPath}`;
};

export const handlers = [
  http.get(apiPath('/runtime-config'), () => HttpResponse.json(configResponse())),
  http.get(apiPath('/preferences/'), () => HttpResponse.json(preferencesResponse())),
  http.get(apiPath('/workspaces/:workspace_id/nodes/:node_id/data'), () =>
    HttpResponse.json(nodeDataResponse()),
  ),
];
