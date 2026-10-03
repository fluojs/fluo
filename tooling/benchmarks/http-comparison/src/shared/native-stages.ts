import { bodyFields, materializeStageDto, StageDto, StageService, type StageShape, serializedStage, serviceResult, stageRoute } from './stage-workloads.js';

export function createNativeStage(shape: StageShape) {
  // The native baseline owns its cache; it does not claim framework DI.
  const singletonCache = new Map<string, StageService>();
  return (method: string, url: URL, body: unknown): { readonly status: number; readonly body: string } => {
    const route = stageRoute(shape);
    const match = shape === 'stage-routing-params' ? /^\/stage\/items\/([^/]+)$/.exec(url.pathname) : undefined;
    if (method !== route.method || (shape === 'stage-routing-params' ? !match : url.pathname !== route.path)) {
      return { status: 404, body: '{}' };
    }
    const query = (key: string) => url.searchParams.get(key) ?? '';
    let result: unknown;
    let disposable: StageService | undefined;
    try {
      switch (shape) {
        case 'stage-minimal':
          result = { ok: true };
          break;
        case 'stage-routing-params':
          result = { itemId: decodeURIComponent(match?.[1] ?? ''), value: query('value') };
          break;
        case 'stage-singleton-di':
        case 'stage-request-di': {
          const cache = shape === 'stage-singleton-di' ? singletonCache : new Map<string, StageService>();
          let first = cache.get('service');
          if (!first) {
            first = new StageService();
            cache.set('service', first);
          }
          const second = cache.get('service');
          if (!second) throw new Error('Stage service cache lost its registration');
          if (shape === 'stage-request-di') disposable = first;
          result = serviceResult(first, second, query('value'), query('probe'));
          break;
        }
        case 'stage-body':
          result = bodyFields(body);
          break;
        case 'stage-guards':
          if (query('token') !== 'allow') return { status: 403, body: '{"error":"forbidden"}' };
          result = { value: query('value'), allowed: true };
          break;
        case 'stage-dto-validation': {
          const dto = materializeStageDto(body);
          if (!dto) return { status: 400, body: '{"error":"invalid DTO"}' };
          result = { name: dto.name, quantity: dto.quantity, bound: dto instanceof StageDto };
          break;
        }
        case 'stage-serialization':
          result = serializedStage(query('value'));
          break;
      }
      return { status: route.method === 'POST' ? 201 : 200, body: JSON.stringify(result) };
    } finally {
      disposable?.onDestroy();
    }
  };
}
