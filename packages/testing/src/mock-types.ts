import type { Mock } from 'vitest';

/**
 * Shallow method-mocked version of a type where function properties become `vitest` mocks.
 */
export type DeepMocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> & T[K] : T[K];
};
