import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';

import { defineClassDiMetadata, defineModuleMetadata } from '../../../packages/core/dist/internal.js';
import { compileModuleGraph, clearModuleGraphCompileCacheForTesting, getModuleGraphCompileCacheSizeForTesting } from '../../../packages/runtime/dist/module-graph.js';

const DEFAULT_ITERATIONS = 2_000;
const SMOKE_ITERATIONS = 100;
const warmupIterations = Number(process.env.BENCH_WARMUP_ITERATIONS ?? 200);
const measuredIterations = Number(process.env.BENCH_ITERATIONS ?? DEFAULT_ITERATIONS);
const outputJson = process.env.BENCH_OUTPUT_JSON;

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function defineInject(target, inject) {
  defineClassDiMetadata(target, { inject });
}

function createProvider(name, dependency) {
  const ProviderClass = class {
    constructor(value) {
      this.value = value;
    }
  };

  Object.defineProperty(ProviderClass, 'name', { value: name });
  defineInject(ProviderClass, dependency ? [dependency] : []);

  return ProviderClass;
}

function createModule(name, metadata) {
  const ModuleClass = class {};
  Object.defineProperty(ModuleClass, 'name', { value: name });
  defineModuleMetadata(ModuleClass, metadata);

  return ModuleClass;
}

function createLeafModule(prefix, providerCount) {
  const providers = [];
  for (let index = 0; index < providerCount; index += 1) {
    providers.push(createProvider(`${prefix}Provider${index}`, providers[index - 1]));
  }

  const moduleType = createModule(`${prefix}Module`, {
    providers,
    exports: providers.slice(-2),
  });

  return { moduleType, exported: providers.at(-1) };
}

function createRootGraph(prefix, options) {
  const imports = [];
  const importedTokens = [];

  for (let index = 0; index < options.importCount; index += 1) {
    const leaf = createLeafModule(`${prefix}Feature${index}`, options.providersPerImport);
    imports.push(leaf.moduleType);
    importedTokens.push(leaf.exported);
  }

  const rootProviders = [];
  for (let index = 0; index < options.rootProviderCount; index += 1) {
    const dependency = index === 0 ? importedTokens[index % importedTokens.length] : rootProviders[index - 1];
    rootProviders.push(createProvider(`${prefix}RootProvider${index}`, dependency));
  }

  const controller = createProvider(`${prefix}Controller`, rootProviders.at(-1));
  const rootModule = createModule(`${prefix}RootModule`, {
    imports,
    providers: rootProviders,
    controllers: [controller],
  });

  return { rootModule, rootProviders };
}

function createRuntimeProviders(prefix, count) {
  return Array.from({ length: count }, (_unused, index) => ({
    provide: Symbol(`${prefix}.runtime.${index}`),
    useValue: { index, prefix },
  }));
}

function createValidationTokens(prefix, count) {
  return Array.from({ length: count }, (_unused, index) => Symbol(`${prefix}.validation.${index}`));
}

function createScenarioGraph(name) {
  if (name === 'small-root') {
    return {
      ...createRootGraph('SmallGraph', { importCount: 2, providersPerImport: 4, rootProviderCount: 6 }),
      options: {},
    };
  }

  if (name === 'wide-imports') {
    return {
      ...createRootGraph('WideGraph', { importCount: 8, providersPerImport: 5, rootProviderCount: 8 }),
      options: {},
    };
  }

  if (name === 'runtime-providers') {
    return {
      ...createRootGraph('RuntimeProviderGraph', { importCount: 5, providersPerImport: 5, rootProviderCount: 8 }),
      options: { providers: createRuntimeProviders('RuntimeProviderGraph', 16) },
    };
  }

  return {
    ...createRootGraph('ValidationTokenGraph', { importCount: 5, providersPerImport: 5, rootProviderCount: 8 }),
    options: { validationTokens: createValidationTokens('ValidationTokenGraph', 16) },
  };
}

function mutateMetadataForInvalidation(rootProvider) {
  const token = Symbol(`metadata-invalidation-${performance.now()}`);
  defineInject(rootProvider, [token]);
}

async function runBenchmark({ name, mode, iterations, run }) {
  for (let index = 0; index < warmupIterations; index += 1) {
    run(index);
  }

  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    run(index);
  }
  const durationMs = performance.now() - started;

  return {
    cacheSize: getModuleGraphCompileCacheSizeForTesting(),
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
  console.log('Runtime module graph focused benchmark');
  console.log(`iterations=${results[0]?.iterations ?? 0} warmup=${warmupIterations}`);
  console.log('HTTP stack is not involved; results isolate compileModuleGraph(...) repeated bootstrap inputs.');
  console.log('');
  for (const result of results) {
    const label = `${result.name} ${result.mode}`.padEnd(maxNameLength);
    console.log(`${label}  ${formatNumber(result.usPerIteration)} us/op  ${formatNumber(result.hz)} ops/sec  cacheSize=${result.cacheSize}`);
  }
}

async function main() {
  const iterations = process.env.BENCH_SMOKE === '1' ? SMOKE_ITERATIONS : measuredIterations;
  assertPositiveInteger('BENCH_ITERATIONS', iterations);
  assertPositiveInteger('BENCH_WARMUP_ITERATIONS', warmupIterations);

  const scenarioNames = ['small-root', 'wide-imports', 'runtime-providers', 'validation-tokens'];
  const results = [];

  for (const name of scenarioNames) {
    const graph = createScenarioGraph(name);

    clearModuleGraphCompileCacheForTesting();
    results.push(await runBenchmark({
      name,
      mode: 'cache-off',
      iterations,
      run: () => compileModuleGraph(graph.rootModule, graph.options),
    }));

    clearModuleGraphCompileCacheForTesting();
    results.push(await runBenchmark({
      name,
      mode: 'cache-on',
      iterations,
      run: () => compileModuleGraph(graph.rootModule, { ...graph.options, moduleGraphCache: true }),
    }));
  }

  const invalidationGraph = createScenarioGraph('validation-tokens');
  clearModuleGraphCompileCacheForTesting();
  results.push(await runBenchmark({
    name: 'metadata-invalidation',
    mode: 'cache-on-changing-metadata',
    iterations,
    run: (index) => {
      if (index % 25 === 0) {
        mutateMetadataForInvalidation(invalidationGraph.rootProviders[0]);
      }
      try {
        compileModuleGraph(invalidationGraph.rootModule, { ...invalidationGraph.options, moduleGraphCache: true });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('cannot access token')) {
          throw error;
        }
      }
    },
  }));

  printResults(results);

  if (outputJson) {
    await writeFile(outputJson, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  }
}

await main();
