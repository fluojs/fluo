import type { Constructor, MaybePromise, MetadataSource } from '@konekti/core';

export interface ValidationIssue {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

export interface Validator {
  validate(value: unknown, target: Constructor): MaybePromise<void>;
  transform<T>(value: unknown, target: Constructor<T>): MaybePromise<T>;
}
