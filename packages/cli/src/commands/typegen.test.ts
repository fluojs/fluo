import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';
import { tsImport } from 'tsx/esm/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runTypegenCommand, type TypegenCommandRuntimeOptions } from './typegen.js';

const fixtureModulePath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/typegen-react-app.module.ts');
const fixtureTsconfigPath = join(dirname(fixtureModulePath), 'tsconfig.json');
const staticRouteId = 'GET /products ProductRouter index';
const dynamicRouteId = 'GET /products/:productId ProductRouter show';
const tempDirectories: string[] = [];

async function loadBuildlessTypegenModules() {
  const options = { parentURL: import.meta.url, tsconfig: fixtureTsconfigPath };
  const [react, runtime, typegen] = await Promise.all([
    tsImport('@fluojs/react', options),
    tsImport('@fluojs/runtime', options),
    tsImport('@fluojs/react/typegen', options),
  ]);

  return {
    react,
    runtime,
    typegen,
  };
}

async function createFixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'fluo-react-typegen-'));
  tempDirectories.push(cwd);
  const outputPath = join(cwd, 'generated', 'react-pages.ts');
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runtime: TypegenCommandRuntimeOptions = {
    cwd,
    loadReactTypegenModules: loadBuildlessTypegenModules,
    stderr: { write: (message) => stderr.push(message) },
    stdout: { write: (message) => stdout.push(message) },
  };

  return { cwd, outputPath, runtime, stderr, stdout };
}

function compile(filePath: string): readonly ts.Diagnostic[] {
  const program = ts.createProgram({
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    },
    rootNames: [filePath],
  });

  return ts.getPreEmitDiagnostics(program);
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('fluo typegen', () => {
  it('creates a deterministic artifact from the compiled React page catalog', async () => {
    // Given
    const fixture = await createFixture();

    // When
    const exitCode = await runTypegenCommand([
      fixtureModulePath,
      '--output',
      fixture.outputPath,
    ], fixture.runtime);

    // Then
    expect(fixture.stderr).toEqual([]);
    expect(exitCode).toBe(0);
    const output = await readFile(fixture.outputPath, 'utf8');
    expect(fixture.stdout.join('')).toContain('CREATE');
    expect(output).toContain(staticRouteId);
    expect(output).toContain(dynamicRouteId);
  });

  it('encodes required params in generated absolute href builders', async () => {
    // Given
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);

    // When
    const generated = await tsImport(pathToFileURL(fixture.outputPath).href, import.meta.url);

    // Then
    const routes = Reflect.get(generated, 'reactPageRoutes');
    expect(typeof routes).toBe('object');
    if (typeof routes !== 'object' || routes === null) {
      throw new TypeError('Expected generated reactPageRoutes object.');
    }
    const route = Reflect.get(routes, dynamicRouteId);
    expect(typeof route).toBe('object');
    if (typeof route !== 'object' || route === null) {
      throw new TypeError('Expected generated dynamic route object.');
    }
    const href = Reflect.get(route, 'href');
    expect(typeof href).toBe('function');
    if (typeof href !== 'function') {
      throw new TypeError('Expected generated href builder.');
    }
    expect(Reflect.apply(href, undefined, [{ productId: 'sku /한글' }])).toBe('/products/sku%20%2F%ED%95%9C%EA%B8%80');
  });

  it('compiles valid static and required-param callsites without a package build', async () => {
    // Given
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    const consumerPath = join(fixture.cwd, 'valid-consumer.ts');
    await writeFile(consumerPath, [
      "import { reactPageRoutes, type ReactPageParams, type ReactPageRouteId } from './generated/react-pages.js';",
      `const routeId: ReactPageRouteId = ${JSON.stringify(dynamicRouteId)};`,
      `const params: ReactPageParams<typeof routeId> = { productId: 'sku-42' };`,
      `reactPageRoutes[${JSON.stringify(staticRouteId)}].href();`,
      'reactPageRoutes[routeId].href(params);',
    ].join('\n'), 'utf8');

    // When
    const diagnostics = compile(consumerPath);

    // Then
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
  });

  it('reports unknown ids and missing or extraneous params as type errors', async () => {
    // Given
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    const consumerPath = join(fixture.cwd, 'invalid-consumer.ts');
    await writeFile(consumerPath, [
      "import { reactPageRoutes } from './generated/react-pages.js';",
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].href();`,
      `reactPageRoutes[${JSON.stringify(staticRouteId)}].href({});`,
      'reactPageRoutes["GET /missing MissingRouter missing"];',
    ].join('\n'), 'utf8');

    // When
    const diagnostics = compile(consumerPath);

    // Then
    expect(diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([2554, 2554, 7053]);
  });

  it('overwrites a stale generated artifact and leaves matching output unchanged', async () => {
    // Given
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    await writeFile(fixture.outputPath, 'stale\n', 'utf8');
    fixture.stdout.splice(0);

    // When
    const updateExitCode = await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    const updated = await readFile(fixture.outputPath, 'utf8');
    const updateOutput = fixture.stdout.join('');
    fixture.stdout.splice(0);
    const unchangedExitCode = await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);

    // Then
    expect(updateExitCode).toBe(0);
    expect(updateOutput).toContain('UPDATE');
    expect(unchangedExitCode).toBe(0);
    expect(updated).not.toBe('stale\n');
    expect(fixture.stdout.join('')).toContain('UNCHANGED');
  });

  it('closes the bootstrapped application when React page catalog projection fails', async () => {
    // Given
    const fixture = await createFixture();
    const close = vi.fn(async () => undefined);
    const projectionError = new Error('React page catalog projection failed.');
    const runtime: TypegenCommandRuntimeOptions = {
      ...fixture.runtime,
      loadReactTypegenModules: async () => ({
        react: {
          createReactPageCatalog: () => {
            throw projectionError;
          },
        },
        runtime: {
          FluoFactory: Object.assign(() => undefined, {
            create: async () => ({
              close,
              dispatcher: { describeRoutes: () => [] },
            }),
          }),
        },
        typegen: { generateReactPageTypes: () => '' },
      }),
    };

    // When
    const exitCode = await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], runtime);

    // Then
    expect(exitCode).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(fixture.stderr).toEqual([`${projectionError.message}\n`]);
  });
});
