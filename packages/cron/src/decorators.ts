import { metadataSymbol } from '@konekti/core';
import { Cron as CronValidator } from 'croner';

import { schedulingMetadataSymbol } from './metadata.js';
import type {
  CronTaskMetadata,
  CronTaskOptions,
  IntervalTaskMetadata,
  IntervalTaskOptions,
  TimeoutTaskMetadata,
  TimeoutTaskOptions,
} from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type MethodDecoratorLike = StandardMethodDecoratorFn;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function defineStandardSchedulingMetadata(
  metadata: unknown,
  propertyKey: string | symbol,
  taskMetadata: CronTaskMetadata | IntervalTaskMetadata | TimeoutTaskMetadata,
): void {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[schedulingMetadataSymbol] as
    | Map<string | symbol, CronTaskMetadata | IntervalTaskMetadata | TimeoutTaskMetadata>
    | undefined;
  const map = current ?? new Map<string | symbol, CronTaskMetadata | IntervalTaskMetadata | TimeoutTaskMetadata>();
  map.set(propertyKey, {
    ...taskMetadata,
    options: { ...taskMetadata.options },
  });
  bag[schedulingMetadataSymbol] = map;
}

function assertValidIntervalMs(ms: number, decoratorName: '@Interval' | '@Timeout'): void {
  if (!Number.isFinite(ms) || !Number.isInteger(ms) || ms <= 0) {
    throw new Error(`${decoratorName}(): ms must be a positive integer.`);
  }
}

function assertMethodIsPublic(context: ClassMethodDecoratorContext, decoratorName: '@Cron' | '@Interval' | '@Timeout'): void {
  if (context.private) {
    throw new Error(`${decoratorName}() cannot be used on private methods.`);
  }
}

export function Cron(expression: string, options: CronTaskOptions = {}): MethodDecoratorLike {
  try {
    new CronValidator(expression, { maxRuns: 0 });
  } catch {
    throw new Error(`@Cron(): invalid cron expression "${expression}".`);
  }

  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    assertMethodIsPublic(context, '@Cron');

    const metadata: CronTaskMetadata = {
      expression,
      kind: 'cron',
      options: { ...options },
    };

    defineStandardSchedulingMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}

export function Interval(ms: number, options: IntervalTaskOptions = {}): MethodDecoratorLike {
  assertValidIntervalMs(ms, '@Interval');

  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    assertMethodIsPublic(context, '@Interval');

    const metadata: IntervalTaskMetadata = {
      kind: 'interval',
      ms,
      options: { ...options },
    };

    defineStandardSchedulingMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}

export function Timeout(ms: number, options: TimeoutTaskOptions = {}): MethodDecoratorLike {
  assertValidIntervalMs(ms, '@Timeout');

  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    assertMethodIsPublic(context, '@Timeout');

    const metadata: TimeoutTaskMetadata = {
      kind: 'timeout',
      ms,
      options: { ...options },
    };

    defineStandardSchedulingMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}
