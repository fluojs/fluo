import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { tsImport } from 'tsx/esm/api';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { runTypegenCommand } from './typegen.js';
import { TypegenCompiler } from './typegen-compiler.js';
import { projectJsonType } from './typegen-projection.js';

const modulePath = fileURLToPath(new URL('../fixtures/typegen-identity.ts', import.meta.url));
const tsconfigPath = fileURLToPath(new URL('../fixtures/tsconfig.json', import.meta.url));

describe('frozen compiler object association', () => {
  it('generates optional converted query and body wire inputs and preserves real omission', async () => {
    // Given: HTTP supports optional HttpWire fields for both query and body.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-optional-wire-'));
    const application = fileURLToPath(new URL('../../../../examples/react-vite-ssr/tests/typegen-fixture/app.module.ts', import.meta.url));
    const output = join(cwd, 'react-pages.ts');
    const errors: string[] = [];
    const options = { parentURL: import.meta.url, tsconfig: tsconfigPath };
    try {
      const [react, runtime, typegen, platform] = await Promise.all([
        tsImport('@fluojs/react', options), tsImport('@fluojs/runtime', options),
        tsImport('@fluojs/react/typegen', options), tsImport('@fluojs/platform-fastify', options),
      ]);
      const exit = await runTypegenCommand([application, '--output', output], {
        cwd, loadReactTypegenModules: async () => ({ react, runtime, typegen }),
        stderr: { write: (message) => { errors.push(message); } }, stdout: { write() {} },
      });
      expect({ exit, errors }).toEqual({ exit: 0, errors: [] });
      const generated = await tsImport(pathToFileURL(output).href, import.meta.url);
      const source = await tsImport(pathToFileURL(application).href, options);
      const adapter = platform.FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
      const app = await runtime.FluoFactory.create(source.AppModule, { adapter });
      try {
        await app.listen();
        const origin = adapter.getListenTarget().url;
        const page = generated.reactPageRoutes['GET /optional/:sku OptionalConvertedRouter show'];
        const form = generated.reactFormRoutes['POST /optional/:sku OptionalConvertedRouter save'];
        // When: generated omission and explicit wire text reach real HTTP binding/conversion.
        for (const [query, expected] of [[{}, 1], [{ count: '2' }, 2]]) {
          const response = await fetch(new URL(page.href({ sku: 'one' }, query), origin), {
            headers: { accept: 'application/vnd.fluo.react-navigation+json;v=2' },
          });
          // Then: omission remains optional and supplied text becomes the server number.
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ destination: { props: { page: expected } } });
        }
        for (const [body, expected] of [[{}, 9], [{ quantity: '3' }, 3]]) {
          const response = await fetch(new URL(form.href({ sku: 'one' }), origin), {
            method: 'POST',
            headers: { accept: 'application/vnd.fluo.form+json;v=1', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ outcome: 'saved', data: { quantity: expected } });
        }
        expect(form.contract.fields.quantity).toBe('quantity');
      } finally {
        await app.close();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('round-trips the generated form action through authoritative URI version dispatch', async () => {
    // Given: the HTTP compiler selects URI versioning for the existing form handler.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-uri-form-'));
    const application = fileURLToPath(new URL('../../../../examples/react-vite-ssr/tests/typegen-fixture/versioned-app.module.ts', import.meta.url));
    const output = join(cwd, 'react-pages.ts');
    const errors: string[] = [];
    const options = { parentURL: import.meta.url, tsconfig: tsconfigPath };
    try {
      const [react, runtime, typegen, platform] = await Promise.all([
        tsImport('@fluojs/react', options), tsImport('@fluojs/runtime', options),
        tsImport('@fluojs/react/typegen', options), tsImport('@fluojs/platform-fastify', options),
      ]);
      const exit = await runTypegenCommand([application, '--output', output], {
        cwd, loadReactTypegenModules: async () => ({ react, runtime, typegen }),
        stderr: { write: (message) => { errors.push(message); } }, stdout: { write() {} },
      });
      expect({ exit, errors }).toEqual({ exit: 0, errors: [] });
      const generated = await tsImport(pathToFileURL(output).href, import.meta.url);
      const source = await tsImport(pathToFileURL(application).href, options);
      const adapter = platform.FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
      const app = await runtime.FluoFactory.create(source.AppModule, { adapter });
      try {
        await app.listen();
        const href = generated.reactFormRoutes['POST /v2/v2/mutations/save SaveRouter save'].href();
        // When: a real listener receives the generated URI action, not a guessed header strategy.
        const response = await fetch(new URL(href, adapter.getListenTarget().url), {
          method: 'POST',
          headers: { accept: 'application/vnd.fluo.form+json;v=1', 'content-type': 'application/json' },
          body: JSON.stringify({ display_name: 'Versioned save' }),
        });
        // Then: the same HTTP DTO/handler returns the negotiated typed acknowledgement.
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ outcome: 'saved', data: { name: 'Versioned save' } });
      } finally {
        await app.close();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it.each(['headerOptions', 'mediaOptions', 'customOptions'])('rejects form href generation for $0 selection', async (optionsExport) => {
    // Given: a versioned ordinary POST uses the application's actual non-URI strategy.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-form-version-'));
    const application = fileURLToPath(new URL('../../../../examples/react-vite-ssr/tests/typegen-fixture/versioned-app.module.ts', import.meta.url));
    const errors: string[] = [];
    try {
      // When: the same typegen command bootstraps the actual shared options export.
      const exit = await runTypegenCommand([
        application, '--output', join(cwd, 'react-pages.ts'), '--options', optionsExport,
      ], {
        cwd,
        async loadReactTypegenModules() {
          const options = { parentURL: import.meta.url, tsconfig: tsconfigPath };
          const [react, runtime, typegen] = await Promise.all([
            tsImport('@fluojs/react', options), tsImport('@fluojs/runtime', options), tsImport('@fluojs/react/typegen', options),
          ]);
          return { react, runtime, typegen };
        },
        stderr: { write: (message) => { errors.push(message); } },
        stdout: { write() {} },
      });
      // Then: a path-only action cannot silently erase authoritative version selection.
      expect({ exit, errors }).toMatchObject({
        exit: 1,
        errors: [expect.stringMatching(/Versioned HTTP form route.*URI/u)],
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('retains the official catalog renderer destination type through its router factory', async () => {
    // Given: the official app passes its concrete HTTP-selected destination to the factory.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-catalog-projection-'));
    const consumer = join(cwd, 'consumer.ts');
    try {
      await symlink(fileURLToPath(new URL('../../../../examples/react-vite-ssr/node_modules', import.meta.url)),
        join(cwd, 'node_modules'), 'dir');
      await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n');
      const catalog = fileURLToPath(new URL('../../../../examples/react-vite-ssr/src/catalog.js', import.meta.url));
      await writeFile(consumer, [
        `import { createCatalogRouter } from ${JSON.stringify(catalog)};`,
        "import { ReactNavigationPage } from '@fluojs/react';",
        "import { createElement } from 'react';",
        "const catalog = createCatalogRouter((props) => ReactNavigationPage.create(createElement('main'), { module: './navigation-catalog.ts', props: { ...props } }));",
        "type Result = ReturnType<InstanceType<typeof catalog.router>['list']>;",
        "function destination(result: Result): './navigation-catalog.ts' { return result.destination.module; }",
        "void destination;",
      ].join('\n'));
      // When: the same strict compiler checks the inferred handler result.
      const program = ts.createProgram([consumer], {
        strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true, jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022, noEmit: true,
      });
      // Then: projection can reach the actual module literal without a copied result type.
      expect(ts.getPreEmitDiagnostics(program).map((entry) => ({
        code: entry.code, file: entry.file?.fileName,
        message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
      }))).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('generates strict aliased converter query from a non-exported DTO and factory-local router', async () => {
    // Given: actual application source owns binding aliases and pre-conversion HttpWire.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-projected-consumer-'));
    const outputPath = join(cwd, 'react-pages.ts');
    const modulePath = fileURLToPath(new URL('../../../../examples/react-vite-ssr/tests/typegen-fixture/app.module.ts', import.meta.url));
    const errors: string[] = [];
    try {
      const exit = await runTypegenCommand([modulePath, '--output', outputPath], {
        cwd,
        async loadReactTypegenModules() {
          const options = { parentURL: import.meta.url, tsconfig: tsconfigPath };
          const [react, runtime, typegen] = await Promise.all([
            tsImport('@fluojs/react', options), tsImport('@fluojs/runtime', options), tsImport('@fluojs/react/typegen', options),
          ]);
          return { react, runtime, typegen };
        },
        stderr: { write: (message) => { errors.push(message); } },
        stdout: { write() {} },
      });
      expect(errors).toEqual([]);
      expect(exit).toBe(0);
      const source = await readFile(outputPath, 'utf8');
      const generated = await tsImport(pathToFileURL(outputPath).href, import.meta.url);
      // When: a strict consumer uses only generated route inference.
      await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n');
      await symlink(fileURLToPath(new URL('../../../../examples/react-vite-ssr/node_modules', import.meta.url)), join(cwd, 'node_modules'), 'dir');
      const consumer = join(cwd, 'consumer.ts');
      await writeFile(consumer, [
        "import { reactPageRoutes, reactFormRoutes } from './react-pages.js';",
        "import { useForm } from '@fluojs/react/client';",
        "import { ReactNavigationPage } from '@fluojs/react';",
        "import { createElement } from 'react';",
        "ReactNavigationPage.create(createElement('main'), { module: './typegen-projected-page.ts', props: { page: 1, product: 'one', tags: [], term: 'hello' } });",
        "const route = reactPageRoutes['GET /search/:sku SearchRouter show'];",
        "route.href({ sku: 'one' }, { term: 'hello', page: '2', tags: ['a', 'b'] });",
        "route.link({ sku: 'one' }, { term: '', page: '3' });",
        "const save = reactFormRoutes['POST /search/:sku SearchRouter save'];",
        "const form = useForm({ id: 'save', action: save.href({ sku: 'one' }), contract: save.contract, allowDestination: () => true });",
        "form.fieldProps('name');",
        "const saved = form.state.mutation;",
        "if (saved?.status === 'saved' && saved.data !== undefined) { const name: string = saved.data.name; const revision: 1 = saved.data.revision; void name; void revision; }",
      ].join('\n'));
      const program = ts.createProgram([consumer], {
        strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022, noEmit: true,
      });
      // Then: generated types and actual URL builders agree without copied Input interfaces.
      expect(ts.getPreEmitDiagnostics(program).map((entry) => ({
        code: entry.code, file: entry.file?.fileName,
        message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
      }))).toEqual([]);
      expect(generated.reactPageRoutes['GET /search/:sku SearchRouter show'].href(
        { sku: 'one' }, { term: 'a+b /한', page: '2', tags: ['', 'a/b'] },
      )).toBe('/search/one?q=a%2Bb+%2F%ED%95%9C&page=2&tag=&tag=a%2Fb');
      expect(source).not.toContain('SearchInput');
      expect(generated.reactPageModules['./typegen-empty-page.ts'].decodeProps({})).toEqual({});
      expect(() => generated.reactPageModules['./typegen-empty-page.ts'].decodeProps({ hidden: true })).toThrow(TypeError);
      expect(generated.reactPageModules['./typegen-projected-page.ts'].decodeProps({
        page: 2, product: 'one', tags: ['a'], term: 'hello',
      })).toEqual({ page: 2, product: 'one', tags: ['a'], term: 'hello' });
      const save = generated.reactFormRoutes['POST /search/:sku SearchRouter save'];
      expect(save.contract.fields).toEqual({ name: 'display_name', csrf: 'csrf' });
      expect(save.contract.decodeSaved({ status: 'saved', name: 'One', revision: 1 })).toEqual({
        status: 'saved', name: 'One', revision: 1,
      });
      expect(() => save.contract.decodeSaved({ status: 'saved', name: 42, revision: 1 })).toThrow(TypeError);
      expect(() => save.contract.decodeSaved({ status: 'saved', name: 'One', revision: 1, secret: 'extra' })).toThrow(TypeError);
      const negative = join(cwd, 'negative.ts');
      await writeFile(negative, [
        "import { reactPageRoutes, reactFormRoutes } from './react-pages.js';",
        "import { useForm } from '@fluojs/react/client';",
        "const page = reactPageRoutes['GET /search/:sku SearchRouter show'];",
        "page.href({ sku: 'one' }, { page: '2' });",
        "page.href({ sku: 'one' }, { term: 'hello', page: 2 });",
        "const extra = { term: 'hello', page: '2', hidden: true }; page.href({ sku: 'one' }, extra);",
        "const union = Math.random() > 0.5 ? { term: 'hello', page: '2' } : { term: 'hello', page: '2', hidden: true }; page.href({ sku: 'one' }, union);",
        "reactPageRoutes['missing-route'];",
        "const save = reactFormRoutes['POST /search/:sku SearchRouter save'];",
        "const form = useForm({ id: 'save', action: save.href({ sku: 'one' }), contract: save.contract, allowDestination: () => true });",
        "form.fieldProps('notDeclared');",
        "const saved = form.state.mutation; if (saved?.status === 'saved' && saved.data !== undefined) { const wrong: number = saved.data.name; void wrong; }",
        "import { ReactNavigationPage } from '@fluojs/react';",
        "import { createElement } from 'react';",
        "ReactNavigationPage.create(createElement('main'), { module: './unregistered.ts', props: {} });",
        "ReactNavigationPage.create(createElement('main'), { module: './typegen-projected-page.ts', props: { page: 'bad', product: 'one', tags: [], term: '' } });",
        "const wrongProps = { page: 1, product: 'one', tags: [], term: '', hidden: true }; ReactNavigationPage.create(createElement('main'), { module: './typegen-projected-page.ts', props: wrongProps });",
      ].join('\n'));
      const invalidProgram = ts.createProgram([negative], program.getCompilerOptions());
      const diagnostics = ts.getPreEmitDiagnostics(invalidProgram).filter((entry) => entry.file?.fileName === negative);
      expect(diagnostics.map((entry) => {
        if (entry.file === undefined) throw new TypeError('Consumer diagnostic has no source location.');
        return entry.file.getLineAndCharacterOfPosition(entry.start ?? 0).line + 1;
      })).toEqual([
        4, 5, 6, 7, 8, 11, 12, 15, 16, 17,
      ]);
      const importOptions = { parentURL: import.meta.url, tsconfig: tsconfigPath };
      const [application, runtime, platform] = await Promise.all([
        tsImport(pathToFileURL(modulePath).href, importOptions),
        tsImport('@fluojs/runtime', importOptions),
        tsImport('@fluojs/platform-fastify', importOptions),
      ]);
      const adapter = platform.FastifyHttpApplicationAdapter.create({
        host: '127.0.0.1', port: 0,
      });
      const app = await runtime.FluoFactory.create(application.AppModule, { adapter });
      try {
        await app.listen();
        const origin = adapter.getListenTarget().url;
        const route = generated.reactPageRoutes['GET /search/:sku SearchRouter show'];
        const href = route.href({ sku: 'one' }, { term: '한 글+/%', page: '2', tags: ['', 'a/b', 'x%y'] });
        const response = await fetch(`${origin}${href}`, {
          headers: { accept: 'application/vnd.fluo.react-navigation+json;v=2' },
        });
        const received: unknown = await response.json();
        expect({ status: response.status, received }).toMatchObject({ status: 200 });
        expect(received).toMatchObject({ destination: { props: {
          page: 2, product: 'one', term: '한 글+/%', tags: ['', 'a/b', 'x%y'],
        } } });
        const invalid = await fetch(`${origin}${route.href({ sku: 'one' }, { term: '', page: 'invalid' })}`, {
          headers: { accept: 'application/vnd.fluo.react-navigation+json;v=2' },
        });
        expect(invalid.status).toBe(400);
        const saved = await fetch(`${origin}${save.href({ sku: 'one' })}`, {
          method: 'POST',
          headers: { accept: 'application/vnd.fluo.form+json;v=1', 'content-type': 'application/json' },
          body: JSON.stringify({ [save.contract.fields.name]: 'One', [save.contract.fields.csrf]: 'token' }),
        });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toMatchObject({ outcome: 'saved', data: {
          status: 'saved', name: 'One', revision: 1,
        } });
      } finally {
        await app.close();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('associates repeated factory-local classes and class expressions by actual identity', async () => {
    // Given: factory invocations create separate constructors with identical class names.
    const snapshot = TypegenCompiler.create({ cwd: dirname(modulePath), modulePath, tsconfigPath });
    const key = `typegen-test-${snapshot.fingerprint}`;
    const recorder = (id: string) => (value: unknown) => snapshot.record(id, value);
    Object.defineProperty(globalThis, key, { configurable: true, value: recorder });
    try {
      const source = snapshot.emit(modulePath, key);
      const fixture = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
      // When: two real factory evaluations create same-named but distinct objects.
      const first = fixture.createIdentityFixture();
      const second = fixture.createIdentityFixture();
      // Then: the same lexical declaration resolves without conflating runtime identity.
      expect(first.Router).not.toBe(second.Router);
      expect(snapshot.declaration(first.Router)).toBe(snapshot.declaration(second.Router));
      expect(snapshot.declaration(first.Router).id).not.toBe(snapshot.declaration(first.Input).id);
      expect(snapshot.declaration(fixture.ExpressionInput).node.kind).toBe(ts.SyntaxKind.ClassExpression);
      const reader = snapshot.instanceType(fixture.GenericReader);
      const get = snapshot.checker.getPropertyOfType(reader, 'get');
      if (get === undefined) throw new TypeError('Expected instantiated generic reader.');
      const method = snapshot.checker.getTypeOfSymbolAtLocation(get, snapshot.declaration(fixture.GenericReader).node);
      const signature = method.getCallSignatures()[0];
      if (signature === undefined) throw new TypeError('Expected instantiated reader signature.');
      expect(projectJsonType({
        snapshot, type: signature.getReturnType(), node: snapshot.declaration(fixture.GenericReader).node,
      })).toEqual({ kind: 'object', fields: {
        tag: { optional: false, shape: { kind: 'literal', value: 'ready' } },
        count: { optional: false, shape: { kind: 'number' } },
      } });
      expect(() => snapshot.declaration(class Router {})).toThrow('Unavailable source association');
    } finally {
      Reflect.deleteProperty(globalThis, key);
    }
  });
});
