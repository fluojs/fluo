import type { MetadataPropertyKey } from '@konekti/core';

import { updateFieldSerializationMetadata } from '../metadata.js';

type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type FieldDecoratorLike = StandardFieldDecoratorFn;

export function Exclude(): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    updateFieldSerializationMetadata(context.metadata, context.name as MetadataPropertyKey, (current) => ({
      ...current,
      excluded: true,
    }));
  };

  return decorator as FieldDecoratorLike;
}
