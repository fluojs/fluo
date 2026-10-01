export type SupportedShape = {
  readonly title: string;
  readonly count: number;
  readonly active: boolean;
  readonly note?: string;
  readonly tags: readonly string[];
  readonly nested: { readonly value: null };
};

export type SupportedUnion = { readonly kind: 'ready'; readonly value: string }
  | { readonly kind: 'missing'; readonly value: null };
export type UnknownShape = unknown;
export type EmptyShape = {};

export type UntrustedAny = ReturnType<JSON['parse']>;
export type UnresolvedShape<T> = { readonly value: T };
export type TupleShape = readonly [string, number];
export type OpenShape = { readonly [key: string]: string };
export type FunctionShape = () => string;
export type MethodShape = { readonly serialize: () => string };
export type SymbolShape = symbol;
export type BigintShape = bigint;
export type DateShape = Date;
export type CustomJsonShape = { toJSON(): { readonly value: string } };
export type RecursiveShape = { readonly next?: RecursiveShape };

export class InstanceShape {
  readonly value = 'plain-looking class';
}
