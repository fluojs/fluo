import type { MetadataPropertyKey } from '@konekti/core';

import { updateClassSerializationOptions, updateFieldSerializationMetadata } from '../metadata.js';

type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type ClassDecoratorLike = StandardClassDecoratorFn;
type FieldDecoratorLike = StandardFieldDecoratorFn;
type ClassOrFieldDecoratorLike = StandardClassDecoratorFn & StandardFieldDecoratorFn;

export interface ExposeClassOptions {
  /**
   * When enabled on a class, only fields marked with `@Expose()` are emitted.
   */
  excludeExtraneous?: boolean;
}

/**
 * Marks a class or field as serializable output.
 *
 * - On classes, configures class-level serialization behavior.
 * - On fields, marks the field as explicitly exposed.
 */
export function Expose(options?: ExposeClassOptions): ClassOrFieldDecoratorLike {
  const decorator = (
    _value: Function | undefined,
    context: ClassDecoratorContext | ClassFieldDecoratorContext<unknown, unknown>,
  ) => {
    if (context.kind === 'class') {
      updateClassSerializationOptions(context.metadata, {
        excludeExtraneous: options?.excludeExtraneous,
      });
      return;
    }

    updateFieldSerializationMetadata(context.metadata, context.name as MetadataPropertyKey, (current) => ({
      ...current,
      exposed: true,
    }));
  };

  return decorator as ClassDecoratorLike & FieldDecoratorLike;
}
