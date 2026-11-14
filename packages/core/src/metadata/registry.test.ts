import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { ModuleKind, transpileModule } from 'typescript';
import { describe, it } from 'vitest';

function runRegistryFixture(setup: string, assertions: string): void {
  const context = createContext({ assert });
  const modules = new Map<string, Record<string, unknown>>();

  function load(url: URL): Record<string, unknown> {
    const cached = modules.get(url.href);
    if (cached) {
      return cached;
    }

    const exports: Record<string, unknown> = {};
    modules.set(url.href, exports);
    const { outputText } = transpileModule(readFileSync(url, 'utf8'), {
      compilerOptions: { module: ModuleKind.CommonJS },
      fileName: url.pathname,
    });
    const evaluate = runInContext(`(function(require, exports) { ${outputText}\n})`, context);
    evaluate((specifier: string) => load(new URL(specifier.replace(/\.js$/, '.ts'), url)), exports);
    return exports;
  }

  runInContext(setup, context);
  context.shared = load(new URL('./shared.ts', import.meta.url));
  context.errors = load(new URL('../errors.ts', import.meta.url));
  context.loadModule = () => load(new URL('./module.ts', import.meta.url));
  runInContext(assertions, context);
}

describe('metadata registry', () => {
  it.each([
    'undefined',
    'null',
    '"occupied"',
    '{ version: 1 }',
    '{ version: 2, counters: new Map(), weakMaps: new Map() }',
    '{ version: 1, counters: {}, weakMaps: new Map() }',
    '{ version: 1, counters: new Map(), weakMaps: {} }',
  ])('rejects a non-configurable collision with %s instead of splitting stores (#4018)', (value) => {
    runRegistryFixture(`
      Object.defineProperty(globalThis, Symbol.for('fluo.metadata.registry.v1'), {
        configurable: false,
        value: ${value},
      });
    `, `
      const isRegistryError = (error) =>
        errors.isFluoError(error, '@fluojs/core')
        && error.code === 'INVARIANT_ERROR'
        && error.message.includes('fluo.metadata.registry.v1');
      const key = Symbol.for('fluo.test.registry-collision');

      assert.throws(() => shared.getGlobalMetadataWeakMap(key), isRegistryError);
      assert.throws(() => shared.getGlobalMetadataCounter(key), isRegistryError);
      assert.throws(() => loadModule(), isRegistryError);
    `);
  });

  it.each([
    '',
    "globalThis[Symbol.for('fluo.metadata.registry.v1')] = { version: 1 };",
    `Object.defineProperty(globalThis, Symbol.for('fluo.metadata.registry.v1'), {
      value: { version: 1, counters: new Map(), weakMaps: new Map() },
    });`,
  ])('retains store identity and metadata with a compatible or replaceable registry: %s', (setup) => {
    runRegistryFixture(`
      globalThis[Symbol.for('fluo.metadata.registry')] = { version: 999 };
      ${setup}
    `, `
      const key = Symbol.for('fluo.test.registry-identity');
      const target = {};
      const store = shared.getGlobalMetadataWeakMap(key);
      const counter = shared.getGlobalMetadataCounter(key);
      store.set(target, 'shared-value');
      counter.value = 7;

      assert.equal(shared.getGlobalMetadataWeakMap(key), store);
      assert.equal(shared.getGlobalMetadataWeakMap(key).get(target), 'shared-value');
      assert.equal(shared.getGlobalMetadataCounter(key), counter);
      assert.equal(shared.getGlobalMetadataCounter(key).value, 7);
      assert.equal(
        Object.getOwnPropertyDescriptor(globalThis, Symbol.for('fluo.metadata.registry.v1')).configurable,
        false,
      );
      assert.equal(globalThis[Symbol.for('fluo.metadata.registry')].version, 999);
    `);
  });
});
