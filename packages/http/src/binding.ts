import { getDtoBindingSchema, type Constructor, type MetadataPropertyKey, type MetadataSource } from '@konekti/core';

import { BadRequestException, type HttpExceptionDetail } from './exceptions.js';
import { toInputErrorDetail } from './input-error-detail.js';
import type { ArgumentResolverContext, Binder, Converter, ConverterTarget, FrameworkRequest } from './types.js';

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

export class DefaultBinder implements Binder {
  constructor(private readonly converter: Converter = new DefaultConverter()) {}

  async bind(dto: Constructor, context: ArgumentResolverContext): Promise<unknown> {
    const schema = getDtoBindingSchema(dto);
    type BindingSchemaEntry = (typeof schema)[number];
    const value = new dto() as Record<string | symbol, unknown>;
    const bodyKeys = new Set<string>(
      schema
        .filter((entry: BindingSchemaEntry) => entry.metadata.source === 'body')
        .map((entry: BindingSchemaEntry) => resolveSourceKey(entry.propertyKey, entry.metadata.key)),
    );

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

      value[entry.propertyKey] = await this.converter.convert(rawValue, {
        dto,
        propertyKey: entry.propertyKey,
        source: entry.metadata.source,
      });
    }

    if (details.length > 0) {
      throw new BadRequestException('Request binding failed.', {
        details,
      });
    }

    return value;
  }
}
