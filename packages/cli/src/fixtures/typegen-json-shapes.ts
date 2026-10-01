/** Supported finite plain-data shape with optional omission and nested arrays. */
export type SupportedShape = {
  readonly title: string;
  readonly count: number;
  readonly active: boolean;
  readonly note?: string;
  readonly tags: readonly string[];
  readonly nested: { readonly value: null };
};

/** Supported discriminated union fixture. */
export type SupportedUnion = { readonly kind: 'ready'; readonly value: string }
  | { readonly kind: 'missing'; readonly value: null };
/** Unknown input must remain untrusted rather than become a concrete decoder. */
export type UnknownShape = unknown;
/** Supported object with no permitted own keys. */
export type EmptyShape = {};

/** Any-like compiler fixture that must not lower to a permissive schema. */
export type UntrustedAny = ReturnType<JSON['parse']>;
/** Unresolved generic fixture requiring an actionable rejection. */
export type UnresolvedShape<T> = { readonly value: T };
/** Tuple fixture outside the current homogeneous-array subset. */
export type TupleShape = readonly [string, number];
/** Open-index fixture outside the finite plain-object subset. */
export type OpenShape = { readonly [key: string]: string };
/** Function fixture with no JSON representation. */
export type FunctionShape = () => string;
/** Method-bearing object fixture rejected by the data-only boundary. */
export type MethodShape = { readonly serialize: () => string };
/** Symbol fixture with no JSON representation. */
export type SymbolShape = symbol;
/** Bigint fixture with no supported JSON encoding. */
export type BigintShape = bigint;
/** Date fixture whose implicit serialization cannot define a plain-data contract. */
export type DateShape = Date;
/** Custom serializer fixture that the generated decoder must not invoke. */
export type CustomJsonShape = { toJSON(): { readonly value: string } };
/** Recursive fixture outside the supported acyclic data subset. */
export type RecursiveShape = { readonly next?: RecursiveShape };

/** Instance fixture distinguishing class ownership from plain JSON shape. */
export class InstanceShape {
  readonly value = 'plain-looking class';
}
