import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';

import { defineClassDiMetadata } from '../../../packages/core/dist/internal.js';
import { Container, Scope } from '../../../packages/di/dist/index.js';

const DEFAULT_ITERATIONS = 5_000;
const SMOKE_ITERATIONS = 250;
const warmupIterations = Number(process.env.BENCH_WARMUP_ITERATIONS ?? 1_000);
const measuredIterations = Number(process.env.BENCH_ITERATIONS ?? DEFAULT_ITERATIONS);
const outputJson = process.env.BENCH_OUTPUT_JSON;

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function defineInject(target, inject, scope) {
  defineClassDiMetadata(target, {
    inject,
    ...(scope ? { scope } : {}),
  });
}

function createDependencyChain(prefix, depth, scope) {
  const providers = [];
  let previousToken;

  for (let index = 0; index < depth; index += 1) {
    const dependency = previousToken;
    const ProviderClass = class {
      constructor(value) {
        this.value = value;
      }
    };

    Object.defineProperty(ProviderClass, 'name', { value: `${prefix}Provider${index}` });
    defineInject(ProviderClass, dependency ? [dependency] : [], scope);
    providers.push(ProviderClass);
    previousToken = ProviderClass;
  }

  return { providers, leaf: previousToken };
}

function createColdPlanContainers(count, factory) {
  return Array.from({ length: count }, (_unused, index) => factory(index));
}

function coldSlotCount(iterations) {
  return iterations + warmupIterations;
}

function createSingletonChainScenario(mode, iterations) {
  if (mode === 'cold-plan') {
    const containers = createColdPlanContainers(coldSlotCount(iterations), () => {
      const chain = createDependencyChain('ColdSingletonChain', 12);
      const container = new Container().register(...chain.providers);

      return { container, token: chain.leaf };
    });

    let index = 0;

    return async () => {
      const entry = containers[index];
      index = (index + 1) % containers.length;
      await entry.container.resolve(entry.token);
    };
  }

  const chain = createDependencyChain('WarmSingletonChain', 12);
  const container = new Container().register(...chain.providers);

  return async () => {
    await container.resolve(chain.leaf);
  };
}

function createRequestScopeScenario(mode, iterations) {
  const makeEntry = (prefix) => {
    class RequestContext {}
    class RequestRepository {
      constructor(context) {
        this.context = context;
      }
    }
    class RequestService {
      constructor(repository) {
        this.repository = repository;
      }
    }

    Object.defineProperty(RequestContext, 'name', { value: `${prefix}Context` });
    Object.defineProperty(RequestRepository, 'name', { value: `${prefix}Repository` });
    Object.defineProperty(RequestService, 'name', { value: `${prefix}Service` });
    defineInject(RequestContext, [], Scope.REQUEST);
    defineInject(RequestRepository, [RequestContext], Scope.REQUEST);
    defineInject(RequestService, [RequestRepository], Scope.REQUEST);

    const container = new Container().register(RequestContext, RequestRepository, RequestService);

    return { container, token: RequestService };
  };

  if (mode === 'cold-plan') {
    const entries = createColdPlanContainers(coldSlotCount(iterations), (index) => makeEntry(`ColdRequest${index}`));
    let index = 0;

    return async () => {
      const entry = entries[index];
      index = (index + 1) % entries.length;
      entry.container.hasRequestScopedDependency(entry.token);
    };
  }

  const entry = makeEntry('WarmRequest');

  return async () => {
    entry.container.hasRequestScopedDependency(entry.token);
  };
}

function createAliasChainScenario(mode, iterations) {
  const makeEntry = (prefix) => {
    const aliasTokens = Array.from({ length: 8 }, (_unused, index) => Symbol(`${prefix}.alias.${index}`));
    class AliasTarget {}
    Object.defineProperty(AliasTarget, 'name', { value: `${prefix}AliasTarget` });

    const providers = [AliasTarget];
    providers.push({ provide: aliasTokens[0], useExisting: AliasTarget });
    for (let index = 1; index < aliasTokens.length; index += 1) {
      providers.push({ provide: aliasTokens[index], useExisting: aliasTokens[index - 1] });
    }

    const container = new Container().register(...providers);

    return { container, token: aliasTokens.at(-1) };
  };

  if (mode === 'cold-plan') {
    const entries = createColdPlanContainers(coldSlotCount(iterations), (index) => makeEntry(`ColdAlias${index}`));
    let index = 0;

    return async () => {
      const entry = entries[index];
      index = (index + 1) % entries.length;
      await entry.container.resolve(entry.token);
    };
  }

  const entry = makeEntry('WarmAlias');

  return async () => {
    await entry.container.resolve(entry.token);
  };
}

function createMultiProviderScenario(mode, iterations) {
  const makeEntry = (prefix) => {
    const token = Symbol(`${prefix}.multi`);
    const providers = [];

    for (let index = 0; index < 16; index += 1) {
      class Contribution {}
      Object.defineProperty(Contribution, 'name', { value: `${prefix}Contribution${index}` });
      providers.push({ provide: token, useClass: Contribution, multi: true });
    }

    const container = new Container().register(...providers);

    return { container, token };
  };

  if (mode === 'cold-plan') {
    const entries = createColdPlanContainers(coldSlotCount(iterations), (index) => makeEntry(`ColdMulti${index}`));
    let index = 0;

    return async () => {
      const entry = entries[index];
      index = (index + 1) % entries.length;
      await entry.container.resolve(entry.token);
    };
  }

  const entry = makeEntry('WarmMulti');

  return async () => {
    await entry.container.resolve(entry.token);
  };
}

function createTransientScenario(mode, iterations) {
  if (mode === 'cold-plan') {
    const entries = createColdPlanContainers(coldSlotCount(iterations), () => {
      const chain = createDependencyChain('ColdTransientChain', 8, Scope.TRANSIENT);
      const container = new Container().register(...chain.providers);

      return { container, token: chain.leaf };
    });
    let index = 0;

    return async () => {
      const entry = entries[index];
      index = (index + 1) % entries.length;
      await entry.container.resolve(entry.token);
    };
  }

  const chain = createDependencyChain('WarmTransientChain', 8, Scope.TRANSIENT);
  const container = new Container().register(...chain.providers);

  return async () => {
    await container.resolve(chain.leaf);
  };
}

async function runBenchmark({ name, mode, iterations, createRun }) {
  const run = createRun(mode, iterations);

  for (let index = 0; index < warmupIterations; index += 1) {
    await run();
  }

  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await run();
  }
  const durationMs = performance.now() - started;

  return {
    hz: iterations / (durationMs / 1_000),
    iterations,
    mode,
    name,
    totalMs: durationMs,
    usPerIteration: (durationMs * 1_000) / iterations,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function printResults(results) {
  const maxNameLength = Math.max(...results.map((result) => `${result.name} ${result.mode}`.length));
  console.log('DI container focused benchmark');
  console.log(`iterations=${results[0]?.iterations ?? 0} warmup=${warmupIterations}`);
  console.log('HTTP stack is not involved; results isolate Container plan lookup/resolution paths.');
  console.log('');
  for (const result of results) {
    const label = `${result.name} ${result.mode}`.padEnd(maxNameLength);
    console.log(`${label}  ${formatNumber(result.usPerIteration)} us/op  ${formatNumber(result.hz)} ops/sec`);
  }
}

async function main() {
  const iterations = process.env.BENCH_SMOKE === '1' ? SMOKE_ITERATIONS : measuredIterations;
  assertPositiveInteger('BENCH_ITERATIONS', iterations);
  assertPositiveInteger('BENCH_WARMUP_ITERATIONS', warmupIterations);

  const scenarios = [
    { name: 'resolve singleton dependency chain', createRun: createSingletonChainScenario },
    { name: 'hasRequestScopedDependency chain', createRun: createRequestScopeScenario },
    { name: 'resolve alias chain', createRun: createAliasChainScenario },
    { name: 'resolve multi-provider token', createRun: createMultiProviderScenario },
    { name: 'resolve transient dependency chain', createRun: createTransientScenario },
  ];
  const results = [];

  for (const scenario of scenarios) {
    results.push(await runBenchmark({ ...scenario, mode: 'cold-plan', iterations }));
    results.push(await runBenchmark({ ...scenario, mode: 'warm-plan', iterations }));
  }

  printResults(results);

  if (outputJson) {
    await writeFile(outputJson, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  }
}

await main();
