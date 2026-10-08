import { STAGE_SHAPES, serializedStage } from './shared/stage-workloads';
import {
  QUOTE_REQUEST_BODY, QUOTE_RESPONSE, READ_SEARCH_PATH, READ_SEARCH_RESPONSE,
  ROUTE_MIX_PATHS, ROUTE_MIX_REQUEST_BODY, ROUTE_MIX_RESPONSES,
} from './shared/workloads';
import type { ScenarioRequest } from './traffic';

export type { AppShape } from './shared/app-shape';

import type { AppShape } from './shared/app-shape';
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

export const STAGE_SCENARIOS: readonly ScenarioConfig[] = STAGE_SHAPES.map((appShape) => {
  let request: ScenarioRequest;
  switch (appShape) {
    case 'stage-minimal':
      request = { path: '/stage', method: 'GET', expectedStatus: 200, expectedBody: '{"ok":true}' };
      break;
    case 'stage-routing-params':
      request = { path: '/stage/items/item-7?value=alpha', method: 'GET', expectedStatus: 200, expectedBody: '{"itemId":"item-7","value":"alpha"}' };
      break;
    case 'stage-singleton-di':
    case 'stage-request-di':
      request = { path: '/stage?value=alpha', method: 'GET', expectedStatus: 200, expectedBody: '{"value":"alpha","doubled":"alphaalpha"}' };
      break;
    case 'stage-body':
    case 'stage-dto-validation':
      request = {
        path: '/stage', method: 'POST', headers: { 'content-type': 'application/json' },
        body: '{"name":"alpha","quantity":3}', expectedStatus: 201,
        expectedBody: appShape === 'stage-body' ? '{"name":"alpha","quantity":3}' : '{"name":"alpha","quantity":3,"bound":true}',
      };
      break;
    case 'stage-guards':
      request = { path: '/stage?token=allow&value=alpha', method: 'GET', expectedStatus: 200, expectedBody: '{"value":"alpha","allowed":true}' };
      break;
    case 'stage-serialization':
      request = { path: '/stage?value=alpha', method: 'GET', expectedStatus: 200, expectedBody: JSON.stringify(serializedStage('alpha')) };
      break;
  }
  return { name: appShape, appShape, description: appShape.slice(6), requests: [request] };
});
