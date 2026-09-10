import {
  type ClassDiMetadata,
  defineClassDiMetadata,
  defineModuleMetadata,
  type ModuleMetadata,
} from './metadata.js';
import type { InjectionToken } from './types.js';

type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;

/**
 * Declares module-level metadata (`imports`, `providers`, `controllers`, `exports`, `global`) on a class.
 *
 * @param definition Module composition metadata; omission or `undefined` uses `{}`.
 * @returns A standard class decorator that records the module contract on the target class.
 * @remarks Empty metadata still registers the module, preserves earlier partial fields, and updates its metadata version.
 */
export function Module(definition: ModuleMetadata = {}): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, definition);
  };
}

/**
 * Defines explicit constructor injection tokens for the decorated class.
 *
 * Passing tokens variadically (`@Inject(A, B)`) is the canonical API. Calling `@Inject()` records an
 * explicit empty inject list so subclasses can intentionally clear inherited constructor tokens.
 * Spread an existing token list with `@Inject(...tokens)`; a nested array is not a token.
 *
 * @param tokens Constructor-parameter token list used by `@fluojs/di` during dependency resolution.
 * @returns A standard class decorator that stores explicit injection metadata on the target class.
 * @throws {TypeError} When an array is passed as a token instead of spreading it.
 */
export function Inject(...tokens: readonly InjectionToken[]): StandardClassDecoratorFn {
  if (tokens.some(Array.isArray)) {
    throw new TypeError('Inject accepts variadic tokens; spread token arrays with Inject(...tokens).');
  }

  return (target) => {
    defineClassDiMetadata(target, { inject: [...tokens] });
  };
}

/**
 * Sets the provider lifecycle scope used by the DI container.
 *
 * @param scope Provider lifetime strategy (`singleton`, `request`, or `transient`).
 * @returns A standard class decorator that stores scope metadata on the target class.
 */
export function Scope(scope: NonNullable<ClassDiMetadata['scope']>): StandardClassDecoratorFn {
  return (target) => {
    defineClassDiMetadata(target, { scope });
  };
}
