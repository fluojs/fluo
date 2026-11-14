import type { MetadataPropertyKey } from '@fluojs/core';

import { type TransformFunction, updateFieldSerializationMetadata } from '../metadata.js';

type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type FieldDecoratorLike = StandardFieldDecoratorFn;

/**
 * Applies a synchronous transformation to the decorated instance field during serialization.
 * Static field applications are ignored; their callbacks never run during serialization.
 *
 * @param transform Function that maps the raw field value to the serialized value.
 * @returns A field decorator that appends the transform to the field metadata.
 *
 * @example
 * ```ts
 * class ProductDto {
 *   @Transform((price) => `$${Number(price).toFixed(2)}`)
 *   price = 0;
 * }
 * ```
 */
export function Transform(transform: TransformFunction): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    if (context.static) {
      return;
    }

    updateFieldSerializationMetadata(context.metadata, context.name as MetadataPropertyKey, (current) => ({
      ...current,
      transforms: [...(current?.transforms ?? []), transform],
    }));
  };

  return decorator as FieldDecoratorLike;
}
