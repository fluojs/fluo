import { type Constructor, InvariantError, type Token } from '@fluojs/core';

import { BadRequestException, type HttpExceptionDetail } from '../exceptions.js';
import { toInputErrorDetail } from '../input-error-detail.js';
import type { ArgumentResolverContext, Binder, Converter, ConverterLike, ConverterTarget, FrameworkRequest } from '../types.js';
import { getCompiledDtoBindingPlan } from './dto-binding-plan.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const NO_CONVERTERS: readonly Converter[] = [];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function validateBodyKeys(
  request: FrameworkRequest,
  bodyKeys: ReadonlySet<string>,
): void {
  if (request.body === undefined || request.body === null) {
    return;
  }

  if (!isPlainObject(request.body)) {
    throw new BadRequestException('Request body must be a plain object.', {
      details: [toInputErrorDetail({ code: 'INVALID_BODY', message: 'Request body must be a plain object.', source: 'body' })],
    });
  }

  const details: HttpExceptionDetail[] = [];

  for (const key of Object.keys(request.body)) {
    if (DANGEROUS_KEYS.has(key)) {
      details.push(toInputErrorDetail({ code: 'DANGEROUS_KEY', field: key, message: `Dangerous body key ${key} is not allowed.`, source: 'body' }));
      continue;
    }

    if (!bodyKeys.has(key)) {
      details.push(toInputErrorDetail({ code: 'UNKNOWN_FIELD', field: key, message: `Unknown body field ${key}.`, source: 'body' }));
    }
  }

  if (details.length > 0) {
    throw new BadRequestException('Request body contains unsupported fields.', {
      details,
    });
  }
}

/**
 * Represents the default converter.
 */
export class DefaultConverter implements Converter {
  convert(value: unknown, _target: ConverterTarget): unknown {
    return value;
  }
}

function isConverter(value: unknown): value is Converter {
  return typeof value === 'object' && value !== null && 'convert' in value && typeof (value as { convert?: unknown }).convert === 'function';
}

function isConverterToken(value: unknown): value is Token<Converter> {
  return typeof value === 'function' || typeof value === 'string' || typeof value === 'symbol';
}

function hasRegisteredConverter(
  container: unknown,
  token: Token<Converter>,
): boolean | undefined {
  if (
    typeof container !== 'object'
    || container === null
    || !('has' in container)
    || typeof container.has !== 'function'
  ) {
    return undefined;
  }

  return container.has(token);
}

async function resolveConverter(
  value: unknown,
  context: ArgumentResolverContext,
  cache: Map<unknown, Converter>,
): Promise<Converter | undefined> {
  if (!value) {
    return undefined;
  }

  if (cache.has(value)) {
    return cache.get(value);
  }

  if (isConverter(value)) {
    cache.set(value, value);
    return value;
  }

  if (!isConverterToken(value)) {
    throw new InvariantError('Converter metadata must be a converter instance or DI token.');
  }

  if (typeof value === 'function' && hasRegisteredConverter(context.requestContext.container, value) === false) {
    const instantiated = new (value as Constructor<Converter>)();

    if (!isConverter(instantiated)) {
      throw new InvariantError('Converter class must implement convert(value, target).');
    }

    cache.set(value, instantiated);
    return instantiated;
  }

  const resolved = await context.requestContext.container.resolve(value as Token<Converter>);

  if (!isConverter(resolved)) {
    throw new InvariantError('Resolved converter token does not implement convert().');
  }

  cache.set(value, resolved);
  return resolved;
}

/**
 * Represents the default binder.
 */
export class DefaultBinder implements Binder {
  constructor(private readonly converters: readonly ConverterLike[] = []) {}

  async bind(dto: Constructor, context: ArgumentResolverContext): Promise<unknown> {
    const plan = getCompiledDtoBindingPlan(dto);
    const request = context.requestContext.request;
    const value = new dto() as Record<string | symbol, unknown>;

    if (request.body !== undefined && request.body !== null) {
      validateBodyKeys(request, plan.bodyKeys);
    }

    const details: HttpExceptionDetail[] = [];

    if (this.converters.length === 0 && !plan.hasFieldConverters) {
      for (const entry of plan.entries) {
        const rawValue = entry.read(request);

        if (rawValue === undefined) {
          if (entry.optional) {
            continue;
          }

          details.push(
            toInputErrorDetail({
              code: 'MISSING_FIELD',
              field: entry.fieldName,
              message: `Missing required ${entry.source} field ${entry.sourceKey}.`,
              source: entry.source,
            }),
          );
          continue;
        }

        value[entry.propertyKey] = rawValue;
      }

      if (details.length > 0) {
        throw new BadRequestException('Request binding failed.', {
          details,
        });
      }

      return value;
    }

    const converterCache = new Map<unknown, Converter>();
    const globalConverters = this.converters.length === 0
      ? NO_CONVERTERS
      : (
          await Promise.all(this.converters.map((converter) => resolveConverter(converter, context, converterCache)))
        ).filter((converter): converter is Converter => Boolean(converter));

    for (const entry of plan.entries) {
      const rawValue = entry.read(request);

      if (rawValue === undefined) {
        if (entry.optional) {
          continue;
        }

        details.push(
          toInputErrorDetail({
            code: 'MISSING_FIELD',
            field: entry.fieldName,
            message: `Missing required ${entry.source} field ${entry.sourceKey}.`,
            source: entry.source,
          }),
        );
        continue;
      }

      const target: ConverterTarget = {
        dto,
        handler: context.handler,
        key: entry.sourceKey,
        propertyKey: entry.propertyKey,
        requestContext: context.requestContext,
        source: entry.source,
      };

      let convertedValue: unknown = rawValue;

      for (const converter of globalConverters) {
        convertedValue = await converter.convert(convertedValue, target);
      }

      if (entry.converter !== undefined) {
        const fieldConverter = await resolveConverter(entry.converter, context, converterCache);

        if (fieldConverter) {
          convertedValue = await fieldConverter.convert(convertedValue, target);
        }
      }

      value[entry.propertyKey] = convertedValue;
    }

    if (details.length > 0) {
      throw new BadRequestException('Request binding failed.', {
        details,
      });
    }

    return value;
  }
}
