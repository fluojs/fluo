import { performance } from 'node:perf_hooks';

import { Inject, Module } from '../../packages/core/src/index';
import { Controller, Get } from '../../packages/http/src/index';
import { KonektiFactory, type ApplicationLogger, type ModuleType } from '../../packages/module/src/index';

type ConstructorToken = new (...args: never[]) => unknown;

const silentLogger: ApplicationLogger = {
  error() {},
  log() {},
};

function createProvider(
  scenarioName: string,
  moduleIndex: number,
  providerIndex: number,
  dependency?: ConstructorToken,
): ConstructorToken {
  @Inject(dependency ? [dependency] : [])
  class BenchProvider {
    constructor(private readonly previous?: { value(): number }) {}

    value(): number {
      return moduleIndex + providerIndex + (this.previous?.value() ?? 0);
    }
  }

  Object.defineProperty(BenchProvider, 'name', {
    value: `${scenarioName}Provider${moduleIndex}_${providerIndex}`,
  });

  return BenchProvider;
}

function createController(
  scenarioName: string,
  moduleIndex: number,
  controllerIndex: number,
  dependency?: ConstructorToken,
): ModuleType {
  @Inject(dependency ? [dependency] : [])
  @Controller(`/${scenarioName.toLowerCase()}-${moduleIndex}-${controllerIndex}`)
  class BenchController {
    constructor(private readonly provider?: { value(): number }) {}

    @Get('/')
    getValue() {
      return {
        ok: true,
        value: this.provider?.value() ?? controllerIndex,
      };
    }
  }

  Object.defineProperty(BenchController, 'name', {
    value: `${scenarioName}Controller${moduleIndex}_${controllerIndex}`,
  });

  return BenchController;
}

function createScenario(
  scenarioName: string,
  moduleCount: number,
  providersPerModule: number,
  controllersPerModule: number,
): ModuleType {
  const modules: ModuleType[] = [];
  let exportedProvider: ConstructorToken | undefined;

  for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex += 1) {
    const providers: ConstructorToken[] = [];
    const controllers: ModuleType[] = [];
    let previousProvider = exportedProvider;

    for (let providerIndex = 0; providerIndex < providersPerModule; providerIndex += 1) {
      const provider = createProvider(scenarioName, moduleIndex, providerIndex, previousProvider);
      providers.push(provider);
      previousProvider = provider;
    }

    for (let controllerIndex = 0; controllerIndex < controllersPerModule; controllerIndex += 1) {
      controllers.push(createController(scenarioName, moduleIndex, controllerIndex, previousProvider));
    }

    @Module({
      controllers,
      exports: previousProvider ? [previousProvider] : [],
      imports: modules.length > 0 ? [modules[modules.length - 1]] : [],
      providers,
    })
    class ScenarioModule {}

    Object.defineProperty(ScenarioModule, 'name', {
      value: `${scenarioName}Module${moduleIndex}`,
    });

    modules.push(ScenarioModule);
    exportedProvider = previousProvider;
  }

  return modules[modules.length - 1] ?? class EmptyScenarioModule {};
}

async function measureScenario(name: string, rootModule: ModuleType, iterations = 5) {
  const samples: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    const app = await KonektiFactory.create(rootModule, {
      logger: silentLogger,
      mode: 'test',
    });
    const bootstrapMs = performance.now() - startedAt;

    await app.close('benchmark');
    samples.push(bootstrapMs);
  }

  const total = samples.reduce((sum, sample) => sum + sample, 0);
  return {
    averageMs: Number((total / samples.length).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
    minMs: Number(Math.min(...samples).toFixed(2)),
    name,
    samples: samples.map((sample) => Number(sample.toFixed(2))),
  };
}

async function main() {
  const scenarios = [
    ['hello-world', createScenario('HelloWorld', 1, 1, 1)],
    ['medium-rest', createScenario('MediumRest', 4, 3, 2)],
    ['module-heavy', createScenario('ModuleHeavy', 8, 4, 3)],
  ] as const;

  const results: Awaited<ReturnType<typeof measureScenario>>[] = [];

  for (const [name, rootModule] of scenarios) {
    results.push(await measureScenario(name, rootModule));
  }

  process.stdout.write(`${JSON.stringify({
    decision: 'defer-compile-time-manifest',
    note: 'Current artifact measures the runtime bootstrap baseline only. Adopt a manifest path only after a prototype shows a meaningful startup gain against these scenarios.',
    results,
  }, null, 2)}\n`);
}

void main();
