import {
  defineClassDiMetadata,
  defineModuleMetadata,
  type ClassDiMetadata,
  type ModuleMetadata,
} from './metadata.js';
import type { Constructor, Token } from './types.js';

type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type DecoratedClass = abstract new (...args: any[]) => unknown;

type TupleOnly<T extends readonly unknown[]> = number extends T['length'] ? never : T;

type ArgForToken<T> = T extends Constructor<infer TValue> ? TValue : any;

type ArgsForTokens<TTokens extends readonly Token[]> = {
  [K in keyof TTokens]: ArgForToken<TTokens[K]>;
};

type CheckedTarget<TTarget extends DecoratedClass, TTokens extends readonly Token[]> =
  TTarget extends abstract new (...args: ArgsForTokens<TTokens>) => unknown ? TTarget : never;

type CheckedDecorator<TTokens extends readonly Token[]> = <TTarget extends DecoratedClass>(
  value: CheckedTarget<TTarget, TTokens>,
  context: ClassDecoratorContext<TTarget>,
) => void;

export function Module(definition: ModuleMetadata): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, definition);
  };
}

export function Global(): StandardClassDecoratorFn {
  return (target) => {
    defineModuleMetadata(target, { global: true });
  };
}

export function Inject<const TTokens extends readonly Token[]>(
  tokens: TupleOnly<TTokens>,
): CheckedDecorator<TTokens>;
export function Inject(tokens: readonly Token[]): StandardClassDecoratorFn {
  return (target) => {
    defineClassDiMetadata(target, { inject: [...tokens] });
  };
}

export function Scope(scope: NonNullable<ClassDiMetadata['scope']>): StandardClassDecoratorFn {
  return (target) => {
    defineClassDiMetadata(target, { scope });
  };
}
