import { http, HttpResponse } from 'msw';

import {
  analysisResponse,
  dataPortalResponse,
  fileResponse,
  nodeResponse,
  nodeRowsArrowStream,
  providerCredentialResponse,
  sampleCatalogueResponse,
  sessionResponse,
  tabResponse,
  tokenizerModelsResponse,
  workspaceResponse,
} from './fixtures';

export const API_MOCK_ORIGIN = 'http://api.test';

/** Matches the generated client's origin-independent `/api` paths. */
const apiPath = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `*/api${normalizedPath}`;
};

const arrowPageResponse = (): HttpResponse =>
  new HttpResponse(nodeRowsArrowStream(), {
    headers: {
      'Content-Type': 'application/vnd.apache.arrow.stream',
      'X-Wordflow-Has-Next': 'false',
    },
  });

const arrowSchemaResponse = (): HttpResponse =>
  new HttpResponse(nodeRowsArrowStream(), {
    headers: { 'Content-Type': 'application/vnd.apache.arrow.stream' },
  });

const emptyAnalysisResult = {
  kind: 'token_frequency',
  analysis_params: {
    node_columns: {},
    node_ids: [],
    node_tokenizer_models: {},
    server_limit: 1,
    stop_words: [],
    token_limit: 1,
  },
  metadata: {
    node_display_names: {},
    node_tokenizer_models: {},
    server_limit: 1,
    stop_words: [],
    token_limit: 1,
  },
  stop_words: [],
  tables: { version: 1, nodes: [], statistics: null },
  token_limit: 1,
};

const acceptedAnalysis = () =>
  analysisResponse({ state: 'queued', progress: { fraction: 0, message: 'Queued' } });

/**
 * Default canonical API responses shared by tests. Individual tests can
 * override these handlers with `server.use` when they need a specific case.
 */
export const handlers = [
  http.get(apiPath('/session'), () => HttpResponse.json(sessionResponse())),
  http.delete(apiPath('/session'), () => new HttpResponse(null, { status: 204 })),
  http.get(apiPath('/storage'), () => HttpResponse.json({ policy: 'unlimited' })),
  http.get(apiPath('/provider-credentials'), () => HttpResponse.json(providerCredentialResponse())),
  http.put(apiPath('/provider-credentials'), () => HttpResponse.json(providerCredentialResponse())),
  http.patch(apiPath('/provider-credentials'), () =>
    HttpResponse.json(providerCredentialResponse()),
  ),
  http.delete(apiPath('/provider-credentials'), () => new HttpResponse(null, { status: 204 })),
  http.get(apiPath('/tokenizer-models'), () => HttpResponse.json(tokenizerModelsResponse())),
  http.get(apiPath('/sample-collections'), () => HttpResponse.json(sampleCatalogueResponse())),
  http.get(apiPath('/data-portal/featured'), () => HttpResponse.json(dataPortalResponse())),
  http.post(apiPath('/data-portal/search'), () => HttpResponse.json(dataPortalResponse())),
  http.post(apiPath('/data-portal/imports'), () => HttpResponse.json(acceptedAnalysis())),
  http.get(apiPath('/user-files'), () => HttpResponse.json([])),
  http.get(apiPath('/user-file-imports'), () =>
    HttpResponse.json({ items: [], page: 1, page_size: 500, total_items: 0, total_pages: 0 }),
  ),
  http.get(apiPath('/user-file-imports/:import_id'), () => HttpResponse.json(acceptedAnalysis())),
  http.post(apiPath('/user-file-imports/:import_id/cancel'), () =>
    HttpResponse.json(acceptedAnalysis()),
  ),
  http.get(apiPath('/user-files/resource'), () => HttpResponse.json(fileResponse())),
  http.get(apiPath('/user-files/raw'), () => new HttpResponse('text')),
  http.get(apiPath('/user-files/content'), () => new HttpResponse(new Blob(['text']))),
  http.get(apiPath('/user-files/preview'), arrowPageResponse),
  http.get(apiPath('/user-files/preview/schema'), arrowSchemaResponse),
  http.get(apiPath('/user-files/worksheets'), () =>
    HttpResponse.json({ sheets: ['Sheet1'], default_sheet: 'Sheet1' }),
  ),
  http.post(apiPath('/user-files/folders'), () =>
    HttpResponse.json(fileResponse({ type: 'directory', name: 'folder', path: 'folder' }), {
      status: 201,
    }),
  ),
  http.post(apiPath('/user-files/uploads'), () =>
    HttpResponse.json(fileResponse(), { status: 201 }),
  ),
  http.patch(apiPath('/user-files'), () => HttpResponse.json(fileResponse())),
  http.delete(apiPath('/user-files'), () => new HttpResponse(null, { status: 204 })),
  http.get(apiPath('/workspaces'), () => HttpResponse.json([workspaceResponse()])),
  http.post(apiPath('/workspaces'), () => HttpResponse.json(workspaceResponse(), { status: 201 })),
  http.get(apiPath('/workspaces/:workspace_id'), () => HttpResponse.json(workspaceResponse())),
  http.patch(apiPath('/workspaces/:workspace_id'), () => HttpResponse.json(workspaceResponse())),
  http.put(apiPath('/workspaces/:workspace_id/open'), () => HttpResponse.json(workspaceResponse())),
  http.delete(
    apiPath('/workspaces/:workspace_id/open'),
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.delete(apiPath('/workspaces/:workspace_id'), () => new HttpResponse(null, { status: 204 })),
  http.get(apiPath('/workspaces/:workspace_id/nodes'), () => HttpResponse.json([nodeResponse()])),
  http.get(apiPath('/workspaces/:workspace_id/nodes/:node_id'), () =>
    HttpResponse.json(nodeResponse()),
  ),
  http.post(apiPath('/workspaces/:workspace_id/nodes'), () =>
    HttpResponse.json(nodeResponse(), { status: 201 }),
  ),
  http.post(apiPath('/workspaces/:workspace_id/nodes/previews'), arrowPageResponse),
  http.patch(apiPath('/workspaces/:workspace_id/nodes/:node_id'), () =>
    HttpResponse.json(nodeResponse()),
  ),
  http.delete(
    apiPath('/workspaces/:workspace_id/nodes/:node_id'),
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.get(apiPath('/workspaces/:workspace_id/nodes/:node_id/rows'), arrowPageResponse),
  http.get(apiPath('/workspaces/:workspace_id/nodes/:node_id/schema'), arrowSchemaResponse),
  http.post(apiPath('/workspaces/:workspace_id/nodes/:node_id/annotation-previews'), () =>
    HttpResponse.json({ labels: [] }),
  ),
  http.get(apiPath('/workspaces/:workspace_id/tabs'), () => HttpResponse.json([])),
  http.post(apiPath('/workspaces/:workspace_id/tabs'), () =>
    HttpResponse.json(tabResponse(), { status: 201 }),
  ),
  http.get(apiPath('/workspaces/:workspace_id/tabs/:tab_id'), () =>
    HttpResponse.json(tabResponse()),
  ),
  http.patch(apiPath('/workspaces/:workspace_id/tabs/:tab_id'), () =>
    HttpResponse.json(tabResponse()),
  ),
  http.delete(
    apiPath('/workspaces/:workspace_id/tabs/:tab_id'),
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.get(apiPath('/workspaces/:workspace_id/tabs/:tab_id/analysis'), () =>
    HttpResponse.json(null),
  ),
  http.post(apiPath('/workspaces/:workspace_id/tabs/:tab_id/analysis'), () =>
    HttpResponse.json(acceptedAnalysis(), { status: 201 }),
  ),
  http.delete(
    apiPath('/workspaces/:workspace_id/tabs/:tab_id/analysis'),
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.get(apiPath('/workspaces/:workspace_id/analyses'), () =>
    HttpResponse.json({
      items: [analysisResponse()],
      page: 1,
      page_size: 500,
      total_items: 1,
      total_pages: 1,
    }),
  ),
  http.get(apiPath('/workspaces/:workspace_id/analyses/:analysis_id'), () =>
    HttpResponse.json(analysisResponse()),
  ),
  http.post(apiPath('/workspaces/:workspace_id/analyses/:analysis_id/cancel'), () =>
    HttpResponse.json(analysisResponse({ state: 'cancelled' })),
  ),
  http.post(apiPath('/workspaces/:workspace_id/analyses/:analysis_id/children'), () =>
    HttpResponse.json(acceptedAnalysis(), { status: 201 }),
  ),
  http.get(apiPath('/workspaces/:workspace_id/analyses/:analysis_id/result'), () =>
    HttpResponse.json(emptyAnalysisResult),
  ),
  http.post(apiPath('/workspaces/:workspace_id/analyses/:analysis_id/result/query'), () =>
    HttpResponse.json(emptyAnalysisResult),
  ),
  http.get(
    apiPath('/workspaces/:workspace_id/archive'),
    () => new HttpResponse(new Blob(['PK']), { headers: { 'Content-Type': 'application/zip' } }),
  ),
  http.post(apiPath('/workspaces/imports'), () =>
    HttpResponse.json(workspaceResponse(), { status: 201 }),
  ),
  http.get(
    apiPath('/events'),
    () =>
      new HttpResponse(
        `event: stream_ready\ndata: ${JSON.stringify({ type: 'stream_ready', sequence: 1, occurred_at: new Date().toISOString() })}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } },
      ),
  ),
];
