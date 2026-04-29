import { performance } from 'node:perf_hooks';

import { defineClassDiMetadata, defineControllerMetadata, defineRouteMetadata } from '../../packages/core/dist/internal.js';
import { Container } from '../../packages/di/dist/index.js';
import { createDispatcher, createHandlerMapping } from '../../packages/http/dist/index.js';

function createRequest(path, method = 'GET', headers = {}) {
  return {
    body: undefined,
    cookies: {},
    headers,
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function resetResponse(response) {
  response.body = undefined;
  response.committed = false;
  response.headers = {};
  response.statusCode = undefined;
  response.statusSet = false;
}

function createResponse() {
  return {
    body: undefined,
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
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

function registerRoute(controllerToken, { basePath, method, methodName, path, guards, interceptors }) {
  defineControllerMetadata(controllerToken, { basePath });
  defineRouteMetadata(controllerToken.prototype, methodName, {
    guards,
    interceptors,
    method,
    path,
  });
}

function buildRouteMatchBenchmarks() {
  class StaticController {
    health() {
      return { ok: true };
    }
  }

  class ParamController {
    getUser() {
      return { ok: true };
    }
  }

  class MixedController {
    getItem() {
      return { ok: true };
    }
  }

  registerRoute(StaticController, {
    basePath: '/health',
    method: 'GET',
    methodName: 'health',
    path: '/',
  });
  registerRoute(ParamController, {
    basePath: '/users',
    method: 'GET',
    methodName: 'getUser',
    path: '/:id',
  });
  registerRoute(MixedController, {
    basePath: '/reports',
    method: 'GET',
    methodName: 'getItem',
    path: '/:reportId/items/:itemId',
  });

  const extraSources = [];
  for (let index = 0; index < 40; index += 1) {
    class ExtraController {
      value() {
        return index;
      }
    }

    registerRoute(ExtraController, {
      basePath: `/extra-${index}`,
      method: 'GET',
      methodName: 'value',
      path: index % 2 === 0 ? '/fixed' : '/:id',
    });

    extraSources.push({ controllerToken: ExtraController });
  }

  const mapping = createHandlerMapping([
    { controllerToken: StaticController },
    { controllerToken: ParamController },
    { controllerToken: MixedController },
    ...extraSources,
  ]);

  return [
    {
      iterations: 200000,
      name: 'route-match static GET /health',
      run() {
        mapping.match(createRequest('/health'));
      },
    },
    {
      iterations: 200000,
      name: 'route-match param GET /users/42',
      run() {
        mapping.match(createRequest('/users/42'));
      },
    },
    {
      iterations: 200000,
      name: 'route-match mixed GET /reports/monthly/items/42',
      run() {
        mapping.match(createRequest('/reports/monthly/items/42'));
      },
    },
  ];
}

function buildDispatchBenchmarks() {
  class HealthController {
    health() {
      return { ok: true };
    }
  }

  registerRoute(HealthController, {
    basePath: '/health',
    method: 'GET',
    methodName: 'health',
    path: '/',
  });

  const emptyPipelineRoot = new Container().register(HealthController);
  const emptyPipelineDispatcher = createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: HealthController }]),
    rootContainer: emptyPipelineRoot,
  });

  const emptyPipelineRequest = createRequest('/health');
  const emptyPipelineResponse = createResponse();

  class Repository {
    read() {
      return { ok: true };
    }
  }

  class Service {
    constructor(repository) {
      this.repository = repository;
    }

    read() {
      return this.repository.read();
    }
  }

  class ChainController {
    constructor(service) {
      this.service = service;
    }

    health() {
      return this.service.read();
    }
  }

  defineClassDiMetadata(Service, { inject: [Repository] });
  defineClassDiMetadata(ChainController, { inject: [Service] });
  registerRoute(ChainController, {
    basePath: '/chain',
    method: 'GET',
    methodName: 'health',
    path: '/',
  });

  const chainRoot = new Container().register(Repository).register(Service).register(ChainController);
  const chainDispatcher = createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: ChainController }]),
    rootContainer: chainRoot,
  });

  const chainRequest = createRequest('/chain');
  const chainResponse = createResponse();

  class AllowGuard {
    canActivate() {
      return true;
    }
  }

  class RouteInterceptor {
    async intercept(_context, next) {
      return next.handle();
    }
  }

  class DecoratedController {
    health() {
      return { ok: true };
    }
  }

  registerRoute(DecoratedController, {
    basePath: '/decorated',
    guards: [AllowGuard],
    interceptors: [RouteInterceptor],
    method: 'GET',
    methodName: 'health',
    path: '/',
  });

  const moduleMiddleware = {
    async handle(_context, next) {
      await next();
    },
  };

  const decoratedRoot = new Container().register(AllowGuard).register(RouteInterceptor).register(DecoratedController);
  const decoratedDispatcher = createDispatcher({
    appMiddleware: [
      {
        async handle(_context, next) {
          await next();
        },
      },
    ],
    handlerMapping: createHandlerMapping([
      {
        controllerToken: DecoratedController,
        moduleMiddleware: [moduleMiddleware],
      },
    ]),
    interceptors: [
      {
        async intercept(_context, next) {
          return next.handle();
        },
      },
    ],
    observers: [
      {
        onHandlerMatched() {},
        onRequestFinish() {},
        onRequestStart() {},
        onRequestSuccess() {},
      },
    ],
    rootContainer: decoratedRoot,
  });

  const decoratedRequest = createRequest('/decorated');
  const decoratedResponse = createResponse();

  return [
    {
      iterations: 20000,
      name: 'dispatch static GET /health (empty pipeline)',
      async run() {
        resetResponse(emptyPipelineResponse);
        await emptyPipelineDispatcher.dispatch(emptyPipelineRequest, emptyPipelineResponse);
      },
    },
    {
      iterations: 20000,
      name: 'dispatch singleton chain GET /chain',
      async run() {
        resetResponse(chainResponse);
        await chainDispatcher.dispatch(chainRequest, chainResponse);
      },
    },
    {
      iterations: 20000,
      name: 'dispatch decorated GET /decorated',
      async run() {
        resetResponse(decoratedResponse);
        await decoratedDispatcher.dispatch(decoratedRequest, decoratedResponse);
      },
    },
  ];
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

  for (const scenario of [...buildRouteMatchBenchmarks(), ...buildDispatchBenchmarks()]) {
    results.push(await measureScenario(scenario));
  }

  process.stdout.write(`${JSON.stringify({
    benchmark: 'http-dispatch-hot-path',
    note: 'Route matching and dispatcher hot-path scenarios measured against built dist artifacts on the current branch.',
    results,
  }, null, 2)}\n`);
}

void main();
