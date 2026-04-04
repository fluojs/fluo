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
 */
export function Module(definition: ModuleMetadata): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, definition);
  };
}

/**
 * Marks the decorated module as global so its exported providers are visible without explicit imports.
 */
export function Global(): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, { global: true });
  };
}

/**
 * Defines explicit constructor injection tokens for the decorated class.
 */
export function Inject<const TTokens extends readonly Token[]>(
  tokens: TupleOnly<TTokens>,
): StandardClassDecoratorFn;
export function Inject(tokens: readonly Token[]): StandardClassDecoratorFn {
  return (target) => {
    defineClassDiMetadata(target, { inject: [...tokens] });
  };
}

/**
 * Sets the provider lifecycle scope used by the DI container.
 */
export function Scope(scope: NonNullable<ClassDiMetadata['scope']>): StandardClassDecoratorFn {
  return (target) => {
    defineClassDiMetadata(target, { scope });
  };
}
