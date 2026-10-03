import type { AppShape } from '../scenarios';
import { comparisonHeaders } from './comparison-headers.js';
import { jsonCommandLocal, readSearchLocal, restRouteMixLocal, toPreviewBody, toQuoteInput } from './workloads.js';

export function nativeResponse(shape: AppShape, method: string, url: URL, body: unknown): { readonly status: number; readonly body: string } {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const query = (name: string) => url.searchParams.get(name) ?? '';
  const tenantId = parts[1] ?? '';
  const projectId = parts[3] ?? '';
  const taskId = parts[5] ?? '';
  let result: unknown;
  let status = 200;
  switch (shape) {
    case 'read-search-local':
      if (method !== 'GET' || parts.length !== 3 || parts[0] !== 'tenants' || parts[2] !== 'users') return { status: 404, body: '{}' };
      result = readSearchLocal({ tenantId, role: query('role'), status: query('status'), region: query('region'), sort: query('sort'), page: query('page'), limit: query('limit') });
      break;
    case 'json-command-local':
      if (method !== 'POST' || url.pathname !== '/orders/quote') return { status: 404, body: '{}' };
      result = jsonCommandLocal(toQuoteInput(body));
      status = 201;
      break;
    case 'rest-route-mix-local': {
      if (parts[0] !== 'tenants' || parts[2] !== 'projects') return { status: 404, body: '{}' };
      if (parts.length === 4 && method === 'GET') result = restRouteMixLocal('project', { tenantId, projectId, include: query('include') });
      else if (parts.length === 5 && parts[4] === 'tasks' && method === 'GET') result = restRouteMixLocal('task-list', { tenantId, projectId, state: query('state'), priority: query('priority') });
      else if (parts[4] === 'tasks' && parts.length === 6 && method === 'GET') result = restRouteMixLocal('task-detail', { tenantId, projectId, taskId });
      else if (parts[4] === 'tasks' && parts.length === 7 && parts[6] === 'comments' && method === 'GET') result = restRouteMixLocal('comments', { tenantId, projectId, taskId });
      else if (parts[4] === 'tasks' && parts.length === 7 && parts[6] === 'preview' && method === 'POST') {
        if (body === undefined) throw new TypeError('Preview body is required');
        result = restRouteMixLocal('preview', { tenantId, projectId, taskId, body: toPreviewBody(body) });
        status = 201;
      } else return { status: 404, body: '{}' };
      break;
    }
  }
  return { status, body: JSON.stringify(result) };
}

export async function nativeFetch(shape: AppShape, request: Request, configuration = process.env.BENCH_CONFIGURATION): Promise<Response> {
  const input: unknown = request.method === 'POST' ? await request.json() : undefined;
  const result = nativeResponse(shape, request.method, new URL(request.url), input);
  return new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json', ...comparisonHeaders(configuration) } });
}
