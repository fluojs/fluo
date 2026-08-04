import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import ts from 'typescript';
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

  it('checks an unchanged artifact without rewriting it', async () => {
    // Given: the target already contains the authoritative generated artifact with an old timestamp.
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    const oldTimestamp = new Date('2020-01-01T00:00:00.000Z');
    await utimes(fixture.outputPath, oldTimestamp, oldTimestamp);
    fixture.stdout.splice(0);

    // When: CI runs non-mutating check mode.
    const exitCode = await runTypegenCommand([
      fixtureModulePath,
      '--output',
      fixture.outputPath,
      '--check',
    ], fixture.runtime);

    // Then: the check succeeds, reports UNCHANGED, and preserves the file timestamp.
    expect(exitCode).toBe(0);
    expect(fixture.stderr).toEqual([]);
    expect(fixture.stdout).toEqual([`UNCHANGED ${fixture.outputPath}\n`]);
    expect((await stat(fixture.outputPath)).mtimeMs).toBe(oldTimestamp.getTime());
  });

  it('reports a missing check target without creating it', async () => {
    // Given: no generated artifact exists at the requested output path.
    const fixture = await createFixture();

    // When: CI checks the missing target.
    const exitCode = await runTypegenCommand([
      fixtureModulePath,
      '--output',
      fixture.outputPath,
      '--check',
    ], fixture.runtime);

    // Then: the missing status has its stable exit code and no target is written.
    expect(exitCode).toBe(2);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr.join('')).toContain(`MISSING ${fixture.outputPath}`);
    await expect(readFile(fixture.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a stale current-version artifact without updating it', async () => {
    // Given: the target is structurally valid but differs from the authoritative catalog output.
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    const stale = (await readFile(fixture.outputPath, 'utf8')).replaceAll('/products', '/stale-products');
    await writeFile(fixture.outputPath, stale, 'utf8');
    fixture.stdout.splice(0);

    // When: CI checks the stale artifact.
    const exitCode = await runTypegenCommand([
      fixtureModulePath,
      '--output',
      fixture.outputPath,
      '--check',
    ], fixture.runtime);

    // Then: stale output is actionable and remains untouched.
    expect(exitCode).toBe(3);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr.join('')).toContain(`STALE ${fixture.outputPath}`);
    expect(await readFile(fixture.outputPath, 'utf8')).toBe(stale);
  });

  it('reports malformed output separately from stale output', async () => {
    // Given: the target does not contain a complete generated artifact header and body.
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    await writeFile(fixture.outputPath, 'not a generated artifact\n', 'utf8');
    fixture.stdout.splice(0);

    // When: CI checks the malformed target.
    const exitCode = await runTypegenCommand([
      fixtureModulePath,
      '--output',
      fixture.outputPath,
      '--check',
    ], fixture.runtime);

    // Then: malformed output has a dedicated diagnostic and exit code.
    expect(exitCode).toBe(4);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr.join('')).toContain(`MALFORMED ${fixture.outputPath}`);
    expect(await readFile(fixture.outputPath, 'utf8')).toBe('not a generated artifact\n');
  });

  it('reports an unsupported artifact version without replacing it', async () => {
    // Given: the target was generated by a newer artifact schema.
    const fixture = await createFixture();
    await runTypegenCommand([fixtureModulePath, '--output', fixture.outputPath], fixture.runtime);
    const unsupported = (await readFile(fixture.outputPath, 'utf8')).replace('Artifact version: 1.', 'Artifact version: 99.');
    await writeFile(fixture.outputPath, unsupported, 'utf8');
    fixture.stdout.splice(0);

    // When: CI checks the newer artifact.
    const exitCode = await runTypegenCommand([
      fixtureModulePath,
      '--output',
      fixture.outputPath,
      '--check',
    ], fixture.runtime);

    // Then: the unsupported version remains distinguishable and untouched.
    expect(exitCode).toBe(5);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr.join('')).toContain(`UNSUPPORTED_VERSION ${fixture.outputPath}`);
    expect(fixture.stderr.join('')).toContain('version 99');
    expect(await readFile(fixture.outputPath, 'utf8')).toBe(unsupported);
  });

  it('rejects combining non-mutating check mode with long-running watch mode', async () => {
    // Given: one invocation requests two mutually exclusive lifecycle modes.
    const fixture = await createFixture();
    const loadReactTypegenModules = vi.fn(fixture.runtime.loadReactTypegenModules);

    // When: argument parsing resolves the conflicting flags.
    const exitCode = await runTypegenCommand([
      fixtureModulePath,
      '--output',
      fixture.outputPath,
      '--check',
      '--watch',
    ], { ...fixture.runtime, loadReactTypegenModules });

    // Then: the command fails before loading or bootstrapping application code.
    expect(exitCode).toBe(1);
    expect(loadReactTypegenModules).not.toHaveBeenCalled();
    expect(fixture.stderr).toEqual(['fluo typegen accepts only one of --check or --watch.\n']);
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
