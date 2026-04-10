import {
  defineClassDiMetadata,
  defineModuleMetadata,
  type ClassDiMetadata,
  type ModuleMetadata,
} from './metadata.js';
import type { Token } from './types.js';

type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;

type TupleOnly<T extends readonly unknown[]> = number extends T['length'] ? never : T;

/**
 * Declares module-level metadata (`imports`, `providers`, `controllers`, `exports`, `global`) on a class.
 *
 * @param definition Module composition metadata consumed by the runtime module-graph compiler.
 * @returns A standard class decorator that records the module contract on the target class.
 */
export function Module(definition: ModuleMetadata): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, definition);
  };
}

/**
 * Marks the decorated module as global so its exported providers are visible without explicit imports.
 *
 * @returns A standard class decorator that marks the target module as globally visible.
 */
export function Global(): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, { global: true });
  };
}

/**
 * Defines explicit constructor injection tokens for the decorated class.
 *
 * Passing tokens variadically (`@Inject(A, B)`) is the canonical API. Calling `@Inject()` records an
 * explicit empty inject list so subclasses can intentionally clear inherited constructor tokens.
 * During the staged migration window, the legacy array form (`@Inject(A, B)`) is still normalized.
 *
 * @param tokens Constructor-parameter token list used by `@konekti/di` during dependency resolution.
 * @returns A standard class decorator that stores explicit injection metadata on the target class.
 */
export function Inject(): StandardClassDecoratorFn;
/**
 * Defines explicit constructor injection tokens for the decorated class.
 *
 * @param tokens Constructor-parameter token list used by `@konekti/di` during dependency resolution.
 * @returns A standard class decorator that stores explicit injection metadata on the target class.
 */
export function Inject<const TTokens extends readonly Token[]>(
  ...tokens: TupleOnly<TTokens>
): StandardClassDecoratorFn;
/**
 * Defines explicit constructor injection tokens for the decorated class.
 *
 * @param tokens Constructor-parameter token list used by `@konekti/di` during dependency resolution.
 * @returns A standard class decorator that stores explicit injection metadata on the target class.
 */
export function Inject(tokens: readonly Token[]): StandardClassDecoratorFn;
/**
 * Defines explicit constructor injection tokens for the decorated class.
 *
 * @param tokensOrList Constructor-parameter token list used by `@konekti/di` during dependency resolution.
 * @returns A standard class decorator that stores explicit injection metadata on the target class.
 */
export function Inject(...tokensOrList: readonly unknown[]): StandardClassDecoratorFn {
  const tokens = tokensOrList.length === 1 && Array.isArray(tokensOrList[0])
    ? [...tokensOrList[0] as readonly Token[]]
    : [...tokensOrList as readonly Token[]];

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
