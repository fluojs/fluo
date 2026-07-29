import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { tsImport } from 'tsx/esm/api';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { runTypegenCommand, type TypegenCommandRuntimeOptions } from './typegen.js';

const fixtureModulePath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/typegen-react-app.module.ts');
const fixtureTsconfigPath = join(dirname(fixtureModulePath), 'tsconfig.json');
const reactClientModulePath = join(dirname(fixtureModulePath), '../../../react/src/client.js');
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

  return { react, runtime, typegen };
}

async function createGeneratedArtifact() {
  const cwd = await mkdtemp(join(tmpdir(), 'fluo-react-navigation-typegen-'));
  tempDirectories.push(cwd);
  await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n', 'utf8');
  const outputPath = join(cwd, 'generated', 'react-pages.ts');
  const runtime: TypegenCommandRuntimeOptions = {
    cwd,
    loadReactTypegenModules: loadBuildlessTypegenModules,
    stderr: { write: () => undefined },
    stdout: { write: () => undefined },
  };
  const exitCode = await runTypegenCommand([fixtureModulePath, '--output', outputPath], runtime);
  expect(exitCode).toBe(0);
  return { cwd, outputPath };
}

function compile(filePath: string): readonly ts.Diagnostic[] {
  const program = ts.createProgram({
    options: {
      exactOptionalPropertyTypes: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    rootNames: [filePath],
  });

  return ts.getPreEmitDiagnostics(program);
}

function invoke(owner: object, key: string, args: readonly unknown[]): unknown {
  const value = Reflect.get(owner, key);
  if (typeof value !== 'function') {
    throw new TypeError(`Expected generated ${key} function.`);
  }
  return Reflect.apply(value, owner, args);
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('fluo typegen navigation authoring', () => {
  it('resolves generated Link props and push or replace calls to ordinary absolute hrefs', async () => {
    // Given: a generated artifact projected from static and parameterized HTTP page descriptors.
    const fixture = await createGeneratedArtifact();
    const generated = await tsImport(pathToFileURL(fixture.outputPath).href, import.meta.url);
    const routes = Reflect.get(generated, 'reactPageRoutes');
    if (typeof routes !== 'object' || routes === null) {
      throw new TypeError('Expected generated reactPageRoutes object.');
    }
    const staticRoute = Reflect.get(routes, staticRouteId);
    const dynamicRoute = Reflect.get(routes, dynamicRouteId);
    if (typeof staticRoute !== 'object' || staticRoute === null || typeof dynamicRoute !== 'object' || dynamicRoute === null) {
      throw new TypeError('Expected generated static and parameterized route objects.');
    }
    const pushed: string[] = [];
    const replaced: string[] = [];
    const navigator = {
      push: (href: string) => pushed.push(href),
      replace: (href: string) => replaced.push(href),
    };

    // When: application code authors a real Link destination and programmatic navigation from route objects.
    const staticLink = invoke(staticRoute, 'link', []);
    const dynamicLink = invoke(dynamicRoute, 'link', [{ productId: 'sku /한글' }]);
    invoke(dynamicRoute, 'push', [navigator, { productId: 'sku /한글' }]);
    invoke(staticRoute, 'replace', [navigator]);

    // Then: every authoring flow resolves before the existing client runtime receives an absolute href.
    expect(staticLink).toEqual({ href: '/products' });
    expect(dynamicLink).toEqual({ href: '/products/sku%20%2F%ED%95%9C%EA%B8%80' });
    expect(pushed).toEqual(['/products/sku%20%2F%ED%95%9C%EA%B8%80']);
    expect(replaced).toEqual(['/products']);
  });

  it('compiles static and parameterized Link, push, and replace authoring', async () => {
    // Given: a consumer using only route identities inferred from its generated artifact.
    const fixture = await createGeneratedArtifact();
    const consumerPath = join(fixture.cwd, 'valid-navigation-consumer.ts');
    await writeFile(consumerPath, [
      "import { reactPageRoutes, type ReactPageLinkProps } from './generated/react-pages.js';",
      `import { Link, type ReactRouter } from ${JSON.stringify(reactClientModulePath)};`,
      'const navigator: ReactRouter = { back: () => undefined, push: () => undefined, refresh: () => undefined, replace: () => undefined };',
      "const params = { productId: 'sku-42' };",
      `const productHref: string = reactPageRoutes[${JSON.stringify(dynamicRouteId)}].href(params);`,
      `const staticLinkProps: ReactPageLinkProps = reactPageRoutes[${JSON.stringify(staticRouteId)}].link();`,
      "Link({ ...staticLinkProps, children: 'Products' });",
      `Link({ ...reactPageRoutes[${JSON.stringify(dynamicRouteId)}].link(params), children: 'Product' });`,
      `reactPageRoutes[${JSON.stringify(staticRouteId)}].push(navigator);`,
      `reactPageRoutes[${JSON.stringify(staticRouteId)}].replace(navigator);`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].push(navigator, params);`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].replace(navigator, { productId: 'sku-84' });`,
      'void productHref;',
    ].join('\n'), 'utf8');

    // When: TypeScript checks the complete declarative and programmatic authoring flow.
    const diagnostics = compile(consumerPath);

    // Then: static routes need no params and parameterized routes accept their complete param object.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
  });

  it('rejects unknown route ids in typed navigation authoring', async () => {
    // Given: a consumer indexing the application-owned artifact with an unknown catalog id.
    const fixture = await createGeneratedArtifact();
    const consumerPath = join(fixture.cwd, 'unknown-route-consumer.ts');
    await writeFile(consumerPath, [
      "import { reactPageRoutes } from './generated/react-pages.js';",
      'reactPageRoutes["GET /missing MissingRouter missing"].link();',
    ].join('\n'), 'utf8');

    // When: TypeScript checks the unknown route callsite.
    const diagnostics = compile(consumerPath);

    // Then: the generated artifact rejects the unrecognized id.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([7053]);
  });

  it('rejects missing params for parameterized Link, push, and replace authoring', async () => {
    // Given: a parameterized generated route and a structurally compatible HTTP-first navigator.
    const fixture = await createGeneratedArtifact();
    const consumerPath = join(fixture.cwd, 'missing-navigation-params-consumer.ts');
    await writeFile(consumerPath, [
      "import { reactPageRoutes, type ReactPageNavigator } from './generated/react-pages.js';",
      'const navigator: ReactPageNavigator = { push: () => undefined, replace: () => undefined };',
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].link();`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].push(navigator);`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].replace(navigator);`,
    ].join('\n'), 'utf8');

    // When: TypeScript checks calls that omit every required path param.
    const diagnostics = compile(consumerPath);

    // Then: all three generated authoring methods require the parameter object.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([2554, 2554, 2554]);
  });

  it('rejects extra params for static and parameterized Link, push, and replace authoring', async () => {
    // Given: generated static and parameterized routes plus calls containing unsupported params.
    const fixture = await createGeneratedArtifact();
    const consumerPath = join(fixture.cwd, 'extra-navigation-params-consumer.ts');
    await writeFile(consumerPath, [
      "import { reactPageRoutes, type ReactPageNavigator } from './generated/react-pages.js';",
      'const navigator: ReactPageNavigator = { push: () => undefined, replace: () => undefined };',
      `reactPageRoutes[${JSON.stringify(staticRouteId)}].link({});`,
      `reactPageRoutes[${JSON.stringify(staticRouteId)}].push(navigator, {});`,
      `reactPageRoutes[${JSON.stringify(staticRouteId)}].replace(navigator, {});`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].link({ productId: 'sku-42', extra: 'value' });`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].push(navigator, { productId: 'sku-42', extra: 'value' });`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].replace(navigator, { productId: 'sku-42', extra: 'value' });`,
    ].join('\n'), 'utf8');

    // When: TypeScript checks static params and excess dynamic param keys.
    const diagnostics = compile(consumerPath);

    // Then: static methods accept no param object and dynamic methods reject unknown keys.
    expect(diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([2322, 2322, 2322, 2554, 2554, 2554]);
  });

  it('rejects aliased extra params for href, Link, push, and replace authoring', async () => {
    // Given: an aliased params object whose required key is accompanied by one unsupported key.
    const fixture = await createGeneratedArtifact();
    const consumerPath = join(fixture.cwd, 'aliased-extra-navigation-params-consumer.ts');
    await writeFile(consumerPath, [
      "import { reactPageRoutes, type ReactPageNavigator } from './generated/react-pages.js';",
      'const navigator: ReactPageNavigator = { push: () => undefined, replace: () => undefined };',
      "const params = { productId: 'sku-42', extra: 'value' };",
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].href(params);`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].link(params);`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].push(navigator, params);`,
      `reactPageRoutes[${JSON.stringify(dynamicRouteId)}].replace(navigator, params);`,
    ].join('\n'), 'utf8');

    // When: TypeScript checks calls that cannot rely on fresh-object excess-property checks.
    const diagnostics = compile(consumerPath);

    // Then: every generated parameterized method rejects the aliased extra key.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([2345, 2345, 2345, 2345]);
  });
});
