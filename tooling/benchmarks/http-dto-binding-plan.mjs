import { performance } from 'node:perf_hooks';

import { defineDtoFieldBindingMetadata } from '../../packages/core/dist/internal.js';
import { Container } from '../../packages/di/dist/index.js';
import { DefaultBinder } from '../../packages/http/dist/internal.js';

function createRequest(overrides = {}) {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'POST',
    params: {},
    path: '/benchmarks',
    query: {},
    raw: {},
    url: '/benchmarks',
    ...overrides,
  };
}

function createResponse() {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createContext(request, container) {
  return {
    handler: {
      controllerToken: class BenchmarkController {},
      metadata: {
        controllerPath: '/benchmarks',
        effectivePath: '/benchmarks/:tenantId/:userId',
        moduleMiddleware: [],
        pathParams: ['tenantId', 'userId'],
      },
      methodName: 'run',
      route: {
        method: 'POST',
        path: '/benchmarks/:tenantId/:userId',
        request: undefined,
      },
    },
    requestContext: {
      container,
      metadata: {},
      request,
      response: createResponse(),
    },
  };
}

function bindField(dto, propertyKey, source, key = propertyKey) {
  defineDtoFieldBindingMetadata(dto.prototype, propertyKey, {
    key: String(key),
    source,
  });
}

const REQUEST_CONVERTER = Symbol('REQUEST_CONVERTER');

class RequestScopedStringConverter {
  convert(value) {
    return typeof value === 'string' ? value.trim() : value;
  }
}

class PathDtoWithDiChain {
  tenantId = '';
  userId = '';
  include = '';
  traceId = '';
  session = '';
  displayName = '';
}

defineDtoFieldBindingMetadata(PathDtoWithDiChain.prototype, 'tenantId', {
  converter: REQUEST_CONVERTER,
  key: 'tenantId',
  source: 'path',
});
bindField(PathDtoWithDiChain, 'userId', 'path', 'userId');
bindField(PathDtoWithDiChain, 'include', 'query', 'include');
bindField(PathDtoWithDiChain, 'traceId', 'header', 'x-trace-id');
bindField(PathDtoWithDiChain, 'session', 'cookie', 'session');
bindField(PathDtoWithDiChain, 'displayName', 'body', 'displayName');

class LargeDtoSchema {}

for (let index = 0; index < 32; index += 1) {
  const propertyKey = `field${index}`;
  LargeDtoSchema.prototype[propertyKey] = '';
  bindField(LargeDtoSchema, propertyKey, 'body', propertyKey);
}

function createPathDtoScenario() {
  const binder = new DefaultBinder([REQUEST_CONVERTER]);
  const rootContainer = new Container().register(RequestScopedStringConverter, {
    provide: REQUEST_CONVERTER,
    scope: 'request',
    useClass: RequestScopedStringConverter,
  });
  const container = rootContainer.createRequestScope();
  const context = createContext(
    createRequest({
      body: { displayName: ' Ada ' },
      cookies: { session: 'cookie-123' },
      headers: { 'x-trace-id': 'trace-123' },
      params: { tenantId: ' tenant-1 ', userId: 'user-42' },
      query: { include: 'profile' },
    }),
    container,
  );

  return {
    iterations: 50000,
    name: 'bind path DTO + request converter DI chain',
    async run() {
      await binder.bind(PathDtoWithDiChain, context);
    },
  };
}

function createLargeDtoScenario() {
  const binder = new DefaultBinder();
  const body = {};

  for (let index = 0; index < 32; index += 1) {
    body[`field${index}`] = `value-${index}`;
  }

  const context = createContext(createRequest({ body }), new Container());

  return {
    iterations: 50000,
    name: 'bind 32-field body DTO schema',
    async run() {
      await binder.bind(LargeDtoSchema, context);
    },
  };
}

async function measureScenario({ iterations, name, run }) {
  const warmupIterations = Math.min(1000, Math.max(100, Math.floor(iterations / 20)));

  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    await run();
  }

  const startedAt = performance.now();

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    await run();
  }

  const durationMs = performance.now() - startedAt;

  return {
    durationMs: Number(durationMs.toFixed(2)),
    iterations,
    name,
    opsPerSecond: Number(((iterations / durationMs) * 1000).toFixed(2)),
    usPerOperation: Number(((durationMs * 1000) / iterations).toFixed(2)),
  };
}

async function main() {
  const results = [];

  for (const scenario of [createPathDtoScenario(), createLargeDtoScenario()]) {
    results.push(await measureScenario(scenario));
  }

  process.stdout.write(`${JSON.stringify({
    benchmark: 'http-dto-binding-plan',
    note: 'DTO binding hot-path scenarios measured against built dist artifacts on the current branch.',
    results,
  }, null, 2)}\n`);
}

void main();
