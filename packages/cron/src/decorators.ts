import { metadataSymbol } from '@konekti/core';
import { Cron as CronValidator } from 'croner';

import type { CronTaskMetadata, CronTaskOptions } from './types.js';
import { cronMetadataSymbol } from './metadata.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type MethodDecoratorLike = StandardMethodDecoratorFn;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function defineStandardCronMetadata(metadata: unknown, propertyKey: string | symbol, cronMetadata: CronTaskMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[cronMetadataSymbol] as Map<string | symbol, CronTaskMetadata> | undefined;
  const map = current ?? new Map<string | symbol, CronTaskMetadata>();
  map.set(propertyKey, {
    expression: cronMetadata.expression,
    options: { ...cronMetadata.options },
  });
  bag[cronMetadataSymbol] = map;
}

export function Cron(expression: string, options: CronTaskOptions = {}): MethodDecoratorLike {
  try {
    new CronValidator(expression, { maxRuns: 0 });
  } catch {
    throw new Error(`@Cron(): invalid cron expression "${expression}".`);
  }

  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    if (context.private) {
      throw new Error('@Cron() cannot be used on private methods.');
    }

    const metadata: CronTaskMetadata = {
      expression,
      options: { ...options },
    };

    defineStandardCronMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}
