import { randomUUID } from 'node:crypto';
import { register, registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileFunction, constants } from 'node:vm';
import ts from 'typescript';

import type { TypegenCompiler } from './typegen-compiler.js';
import { TypegenCommandError } from './typegen-options.js';

let floorLoaderActivity: Int32Array | undefined;

// Node 24.11.0 validates synchronous delegated results before they reach our
// hook. Normalize the async CommonJS boundary first, without guessing format.
const floorLoaderSource = `
import { readFile } from 'node:fs/promises';
let activity;
export function initialize(buffer) { activity = new Int32Array(buffer); }
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (Atomics.load(activity, 0) === 0 || result.format !== 'commonjs' || result.source != null) return result;
  const sourceURL = new URL(result.responseURL ?? url);
  if (sourceURL.protocol !== 'file:') return result;
  return { ...result, source: await readFile(sourceURL) };
}
`;

// Emitted decorator arrays retain these callbacks in the native module cache.
// Keep their closure separate from the consuming scope and clear its sole graph reference.
function createTypegenRecorder(snapshot: TypegenCompiler) {
  let current: TypegenCompiler | undefined = snapshot;
  return {
    record: (id: string) => (value: unknown) => {
      if (current === undefined) throw new TypegenCommandError('Typegen generation has completed.');
      return current.record(id, value);
    },
    dispose() {
      current = undefined;
    },
  };
}

/**
 * Evaluate and consume the frozen compiler graph with generation-owned instrumentation.
 *
 * @param options Frozen compiler snapshot and application module path.
 * @param consume Bootstrap/close callback retaining instrumentation for nested factories.
 * @returns The callback's generated artifact after hook and recorder teardown.
 */
export async function consumeTypegenSource<Result>(
  options: { readonly snapshot: TypegenCompiler; readonly modulePath: string },
  consume: (application: object) => Promise<Result>,
): Promise<Result> {
  const { snapshot } = options;
  if (process.versions.node === '24.11.0' && floorLoaderActivity === undefined) {
    floorLoaderActivity = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    register(`data:text/javascript,${encodeURIComponent(floorLoaderSource)}`, {
      data: floorLoaderActivity.buffer,
    });
  }
  const activity = process.versions.node === '24.11.0' ? floorLoaderActivity : undefined;
  if (activity !== undefined) Atomics.add(activity, 0, 1);
  const key = `fluo.typegen.${randomUUID()}`;
  const marker = `fluo-typegen=${key}`;
  const recorder = createTypegenRecorder(snapshot);
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: recorder.record,
  });
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith('file:')
        && new URL(context.parentURL).searchParams.get('fluo-typegen') === key) {
        const parent = fileURLToPath(context.parentURL);
        const resolved = ts.resolveModuleName(specifier, parent, snapshot.options, ts.sys).resolvedModule?.resolvedFileName;
        if (resolved !== undefined && snapshot.sources.has(resolve(resolved))
          && snapshot.sources.get(resolve(resolved))?.isDeclarationFile === false) {
          return { shortCircuit: true, url: `${pathToFileURL(resolved).href}?${marker}` };
        }
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && new URL(url).searchParams.get('fluo-typegen') === key) {
        return {
          format: 'module',
          shortCircuit: true,
          source: snapshot.emit(fileURLToPath(url), key),
        };
      }
      return nextLoad(url, context);
    },
  });
  try {
    const importNative = compileFunction('return import(url)', ['url'], {
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
    const application: unknown = await Reflect.apply(importNative, undefined, [
      `${pathToFileURL(resolve(options.modulePath)).href}?${marker}`,
    ]);
    if (typeof application !== 'object' || application === null) {
      throw new TypegenCommandError('Application evaluation did not return a module namespace.');
    }
    return await consume(application);
  } finally {
    recorder.dispose();
    hooks.deregister();
    if (activity !== undefined) Atomics.sub(activity, 0, 1);
    Reflect.deleteProperty(globalThis, key);
  }
}

/**
 * Locate the application's existing compiler configuration without inventing defaults.
 *
 * @param modulePath Absolute application module path.
 * @returns The nearest existing tsconfig path, or `undefined`.
 */
export function findTypegenTsconfig(modulePath: string): string | undefined {
  return ts.findConfigFile(dirname(modulePath), ts.sys.fileExists);
}
