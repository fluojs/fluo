import type { MetadataPropertyKey } from '@fluojs/core';

import { updateFieldSerializationMetadata } from '../metadata.js';

type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type FieldDecoratorLike = StandardFieldDecoratorFn;

/**
 * Excludes the decorated instance field from serialized output.
 * Static field applications are ignored and leave instance serialization unchanged.
 *
 * @returns A field decorator that marks the property as omitted during serialization.
 *
 * @example
 * ```ts
 * class UserEntity {
 *   @Exclude()
 *   passwordHash = '';
 * }
 * ```
 */
export function Exclude(): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    if (context.static) {
      return;
    }

    updateFieldSerializationMetadata(context.metadata, context.name as MetadataPropertyKey, (current) => ({
      ...current,
      excluded: true,
    }));
  };

  return decorator as FieldDecoratorLike;
}
