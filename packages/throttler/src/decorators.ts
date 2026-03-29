import type { ThrottlerHandlerOptions } from './types.js';
import { validateThrottleOptions } from './validation.js';

export const throttleRouteMetadataKey = Symbol.for('konekti.standard.route');
const throttleKey = Symbol.for('konekti.throttler.throttle');
const skipThrottleKey = Symbol.for('konekti.throttler.skip');
const classThrottleKey = Symbol.for('konekti.throttler.class-throttle');
const classSkipThrottleKey = Symbol.for('konekti.throttler.class-skip');

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type ClassOrMethodDecoratorLike = StandardClassDecoratorFn & StandardMethodDecoratorFn;

function getMetadataBag(metadata: unknown): StandardMetadataBag {
  return metadata as StandardMetadataBag;
}

function cloneThrottleOptions(options: ThrottlerHandlerOptions): ThrottlerHandlerOptions {
  return validateThrottleOptions({
    limit: options.limit,
    ttl: options.ttl,
  });
}

function getRouteRecord(metadata: unknown, name: string | symbol): StandardMetadataBag {
  const bag = getMetadataBag(metadata);
  let routeMap = bag[throttleRouteMetadataKey] as Map<string | symbol, StandardMetadataBag> | undefined;

  if (!routeMap) {
    routeMap = new Map<string | symbol, StandardMetadataBag>();
    bag[throttleRouteMetadataKey] = routeMap;
  }

  let record = routeMap.get(name);

  if (!record) {
    record = {};
    routeMap.set(name, record);
  }

  return record;
}

export function Throttle(options: ThrottlerHandlerOptions): ClassOrMethodDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      getMetadataBag(context.metadata)[classThrottleKey] = cloneThrottleOptions(options);
    } else {
      getRouteRecord(context.metadata, context.name)[throttleKey] = cloneThrottleOptions(options);
    }
  };

  return decorator as ClassOrMethodDecoratorLike;
}

export function SkipThrottle(): ClassOrMethodDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      getMetadataBag(context.metadata)[classSkipThrottleKey] = true;
    } else {
      getRouteRecord(context.metadata, context.name)[skipThrottleKey] = true;
    }
  };

  return decorator as ClassOrMethodDecoratorLike;
}

export function getThrottleMetadata(bag: StandardMetadataBag): ThrottlerHandlerOptions | undefined {
  const metadata = bag[throttleKey] as ThrottlerHandlerOptions | undefined;
  return metadata ? cloneThrottleOptions(metadata) : undefined;
}

export function getSkipThrottleMetadata(bag: StandardMetadataBag): boolean {
  return bag[skipThrottleKey] === true;
}

export function getClassThrottleMetadata(bag: StandardMetadataBag): ThrottlerHandlerOptions | undefined {
  const metadata = bag[classThrottleKey] as ThrottlerHandlerOptions | undefined;
  return metadata ? cloneThrottleOptions(metadata) : undefined;
}

export function getClassSkipThrottleMetadata(bag: StandardMetadataBag): boolean {
  return bag[classSkipThrottleKey] === true;
}
