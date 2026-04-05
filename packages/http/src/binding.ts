import { InvariantError, type Constructor, type MetadataPropertyKey, type MetadataSource, type Token } from '@konekti/core';
import { getDtoBindingSchema } from '@konekti/core/internal';

import { BadRequestException, type HttpExceptionDetail } from './exceptions.js';
import { toInputErrorDetail } from './input-error-detail.js';
import type { ArgumentResolverContext, Binder, Converter, ConverterLike, ConverterTarget, FrameworkRequest } from './types.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function toFieldName(propertyKey: MetadataPropertyKey): string {
  return typeof propertyKey === 'string' ? propertyKey : String(propertyKey);
}

function resolveSourceKey(propertyKey: MetadataPropertyKey, key?: string): string {
  return key ?? toFieldName(propertyKey);
}

function readHeader(request: FrameworkRequest, key: string): string | string[] | undefined {
  return request.headers[key.toLowerCase()] ?? request.headers[key];
}

function readSourceValue(
  request: FrameworkRequest,
  source: MetadataSource,
  propertyKey: MetadataPropertyKey,
  key?: string,
): unknown {
  const resolvedKey = resolveSourceKey(propertyKey, key);

  switch (source) {
    case 'path':
      return request.params[resolvedKey];
    case 'query':
      return request.query[resolvedKey];
    case 'header':
      return readHeader(request, resolvedKey);
    case 'cookie':
      return request.cookies[resolvedKey];
    case 'body': {
      if (!isPlainObject(request.body)) {
        if (request.body !== undefined && request.body !== null) {
          throw new BadRequestException('Request body must be a plain object.', {
            details: [toInputErrorDetail({ code: 'INVALID_BODY', message: 'Request body must be a plain object.', source: 'body' })],
          });
        }
        return undefined;
      }

      return request.body[resolvedKey];
    }
  }
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

  try {
    const resolved = await context.requestContext.container.resolve(value as Token<Converter>);

    if (!isConverter(resolved)) {
      throw new InvariantError('Resolved converter token does not implement convert().');
    }

    cache.set(value, resolved);
    return resolved;
  } catch (error) {
    if (typeof value === 'function') {
      const instantiated = new (value as Constructor<Converter>)();

      if (!isConverter(instantiated)) {
        throw new InvariantError('Converter class must implement convert(value, target).');
      }

      cache.set(value, instantiated);
      return instantiated;
    }

    throw error;
  }
}

export class DefaultBinder implements Binder {
  constructor(private readonly converters: readonly ConverterLike[] = []) {}

  async bind(dto: Constructor, context: ArgumentResolverContext): Promise<unknown> {
    const schema = getDtoBindingSchema(dto);
    type BindingSchemaEntry = (typeof schema)[number];
    const value = new dto() as Record<string | symbol, unknown>;
    const converterCache = new Map<unknown, Converter>();
    const bodyKeys = new Set<string>(
      schema
        .filter((entry: BindingSchemaEntry) => entry.metadata.source === 'body')
        .map((entry: BindingSchemaEntry) => resolveSourceKey(entry.propertyKey, entry.metadata.key)),
    );
    const globalConverters = (
      await Promise.all(this.converters.map((converter) => resolveConverter(converter, context, converterCache)))
    ).filter((converter): converter is Converter => Boolean(converter));

    validateBodyKeys(context.requestContext.request, bodyKeys);

    const details: HttpExceptionDetail[] = [];

    for (const entry of schema) {
      const rawValue = readSourceValue(
        context.requestContext.request,
        entry.metadata.source,
        entry.propertyKey,
        entry.metadata.key,
      );

      if (rawValue === undefined) {
        if (entry.metadata.optional) {
          continue;
        }

        details.push(
          toInputErrorDetail({
            code: 'MISSING_FIELD',
            field: toFieldName(entry.propertyKey),
            message: `Missing required ${entry.metadata.source} field ${resolveSourceKey(entry.propertyKey, entry.metadata.key)}.`,
            source: entry.metadata.source,
          }),
        );
        continue;
      }

      const target: ConverterTarget = {
        dto,
        handler: context.handler,
        key: resolveSourceKey(entry.propertyKey, entry.metadata.key),
        propertyKey: entry.propertyKey,
        requestContext: context.requestContext,
        source: entry.metadata.source,
      };

      let convertedValue: unknown = rawValue;

      for (const converter of globalConverters) {
        convertedValue = await converter.convert(convertedValue, target);
      }

      const fieldConverter = await resolveConverter(entry.metadata.converter, context, converterCache);

      if (fieldConverter) {
        convertedValue = await fieldConverter.convert(convertedValue, target);
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
