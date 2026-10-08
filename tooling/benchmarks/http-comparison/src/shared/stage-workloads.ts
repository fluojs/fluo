export const STAGE_SHAPES = [
  'stage-minimal', 'stage-routing-params', 'stage-singleton-di', 'stage-request-di',
  'stage-body', 'stage-guards', 'stage-dto-validation', 'stage-serialization',
] as const;
export type StageShape = typeof STAGE_SHAPES[number];

export function isStageShape(shape: string): shape is StageShape {
  return STAGE_SHAPES.some((candidate) => candidate === shape);
}

export function stageRoute(shape: StageShape) {
  return {
    method: shape === 'stage-body' || shape === 'stage-dto-validation' ? 'POST' : 'GET',
    path: shape === 'stage-routing-params' ? '/stage/items/:itemId' : '/stage',
  } as const;
}

/** Paired fixtures, not cumulative or exclusive stage timers. */
export const STAGE_FEATURES = {
  'stage-minimal': { input: 'none', fluo: 'zero-argument handler; plain JSON', native: 'literal route; plain JSON', nestjs: 'zero-argument handler; plain JSON' },
  'stage-routing-params': { input: 'unescaped path itemId + query value; percent decoding remains host-owned', fluo: 'parameterized route; RequestContext', native: 'host route on Fastify/Express; URL extraction elsewhere', nestjs: 'parameterized route; @Param + @Query' },
  'stage-singleton-di': { input: 'query value', fluo: 'singleton service injected twice; singleton controller', native: 'application-owned singleton; two cache reads', nestjs: 'singleton service injected twice; singleton controller' },
  'stage-request-di': { input: 'query value', fluo: 'explicit request controller/service; container onDestroy after dispatch', native: 'request-local cache; explicit disposal after JSON encoding', nestjs: 'request controller/service; explicit disposal on raw response finish, not automatic Nest lifecycle' },
  'stage-body': { input: 'JSON name + quantity', fluo: 'RequestContext.request.body; no DTO validators', native: 'host JSON parser; field extraction', nestjs: '@Body; no DTO validators' },
  'stage-guards': { input: 'query token + value', fluo: '@UseGuards; RequestContext', native: 'explicit predicate before handler', nestjs: '@UseGuards; ExecutionContext' },
  'stage-dto-validation': { input: 'JSON name + quantity; unknown fields rejected', fluo: '@RequestDto + @FromBody + field validators', native: 'explicit DTO materialization and matching field validation', nestjs: '@Body custom DTO pipe; not class-validator/ValidationPipe' },
  'stage-serialization': { input: 'query value', fluo: 'generated nested plain object; JSON encoding, no serializer plugin', native: 'same generated object; JSON.stringify', nestjs: 'same generated object; host JSON encoding, no shaping interceptor' },
} as const;

export class StageDto {
  name = '';
  quantity = 0;
}

export function bodyFields(body: unknown): { readonly name: unknown; readonly quantity: unknown } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { name: undefined, quantity: undefined };
  return {
    name: 'name' in body ? body.name : undefined,
    quantity: 'quantity' in body ? body.quantity : undefined,
  };
}

export function materializeStageDto(body: unknown): StageDto | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  if (Object.keys(body).some((key) => key !== 'name' && key !== 'quantity')) return undefined;
  const { name, quantity } = bodyFields(body);
  if (typeof name !== 'string' || name.length < 1 || !Number.isInteger(quantity) || typeof quantity !== 'number' || quantity < 1) return undefined;
  return Object.assign(new StageDto(), { name, quantity });
}

export function serializedStage(value: string) {
  return {
    value,
    items: Array.from({ length: 16 }, (_, index) => ({ index, label: `${value}:${index}`, enabled: index % 2 === 0 })),
  };
}

/** No listeners or retained per-request history during timing runs. */
export class StageService {
  private static nextId = 0;
  static onLifecycle: ((event: 'create' | 'dispose', id: number) => void) | undefined;
  readonly id = ++StageService.nextId;
  constructor() { StageService.onLifecycle?.('create', this.id); }
  run(value: string) { return { value, doubled: value + value }; }
  onDestroy() { StageService.onLifecycle?.('dispose', this.id); }
}

export function serviceResult(first: StageService, second: StageService, value: string, probe: string) {
  const result = first.run(value);
  return probe === '1' ? { ...result, instanceId: first.id, reused: first === second } : result;
}
