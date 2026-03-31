import { type MetadataPropertyKey } from '@konekti/core';

import { type TransformFunction, updateFieldSerializationMetadata } from '../metadata.js';

type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type FieldDecoratorLike = StandardFieldDecoratorFn;

export function Transform(transform: TransformFunction): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    updateFieldSerializationMetadata(context.metadata, context.name as MetadataPropertyKey, (current) => ({
      ...current,
      transforms: [...(current?.transforms ?? []), transform],
    }));
  };

  return decorator as FieldDecoratorLike;
}
