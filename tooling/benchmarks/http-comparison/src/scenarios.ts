import {
  QUOTE_REQUEST_BODY, QUOTE_RESPONSE, READ_SEARCH_PATH, READ_SEARCH_RESPONSE,
  ROUTE_MIX_PATHS, ROUTE_MIX_REQUEST_BODY, ROUTE_MIX_RESPONSES,
} from './shared/workloads';
import type { ScenarioRequest } from './traffic';

export type AppShape = 'read-search-local' | 'json-command-local' | 'rest-route-mix-local';
export interface ScenarioConfig {
  readonly appShape: AppShape;
  readonly name: string;
  readonly description: string;
  readonly requests: readonly ScenarioRequest[];
}

export const SCENARIOS: readonly ScenarioConfig[] = [
  {
    name: 'read-search-local', appShape: 'read-search-local',
    description: 'Read-heavy tenant user search: path/query binding, DI, in-memory filtering',
    requests: [{ path: READ_SEARCH_PATH, method: 'GET', expectedBody: READ_SEARCH_RESPONSE, expectedStatus: 200 }],
  },
  {
    name: 'json-command-local', appShape: 'json-command-local',
    description: 'JSON body materialization, shared normalization, quote calculation and serialization',
    requests: [{ path: '/orders/quote', method: 'POST', body: QUOTE_REQUEST_BODY,
      headers: { 'content-type': 'application/json' }, expectedBody: QUOTE_RESPONSE, expectedStatus: 201 }],
  },
  {
    name: 'rest-route-mix-local', appShape: 'rest-route-mix-local',
    description: 'Deterministic per-connection cycle: project, tasks, detail, POST preview, comments',
    requests: ROUTE_MIX_PATHS.map((path, index) => ({
      path, expectedBody: ROUTE_MIX_RESPONSES[index], expectedStatus: path.endsWith('/preview') ? 201 : 200,
      ...(path.endsWith('/preview')
        ? { method: 'POST' as const, body: ROUTE_MIX_REQUEST_BODY, headers: { 'content-type': 'application/json' } }
        : { method: 'GET' as const }),
    })),
  },
];
