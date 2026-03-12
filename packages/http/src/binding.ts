import { getDtoBindingSchema, type Constructor, type MetadataPropertyKey, type MetadataSource } from '@konekti/core';

import { BadRequestException, type HttpExceptionDetail } from './exceptions';
import type { ArgumentResolverContext, Binder, Converter, ConverterTarget, FrameworkRequest } from './types';

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

function toDetail(code: string, message: string, field?: string, source?: MetadataSource): HttpExceptionDetail {
  return {
    code,
    field,
    message,
    source,
  };
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
      details: [toDetail('INVALID_BODY', 'Request body must be a plain object.', undefined, 'body')],
    });
  }

  const details: HttpExceptionDetail[] = [];

  for (const key of Object.keys(request.body)) {
    if (DANGEROUS_KEYS.has(key)) {
      details.push(toDetail('DANGEROUS_KEY', `Dangerous body key ${key} is not allowed.`, key, 'body'));
      continue;
    }

    if (!bodyKeys.has(key)) {
      details.push(toDetail('UNKNOWN_FIELD', `Unknown body field ${key}.`, key, 'body'));
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
    if (Array.isArray(value) && value.length === 1) {
      return value[0];
    }

    return value;
  }
}

export class DefaultBinder implements Binder {
  constructor(private readonly converter: Converter = new DefaultConverter()) {}

  async bind(dto: Constructor, context: ArgumentResolverContext): Promise<unknown> {
    const schema = getDtoBindingSchema(dto);
    const value = new dto() as Record<string | symbol, unknown>;
    const bodyKeys = new Set(
      schema
        .filter((entry) => entry.metadata.source === 'body')
        .map((entry) => resolveSourceKey(entry.propertyKey, entry.metadata.key)),
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
          toDetail(
            'MISSING_FIELD',
            `Missing required ${entry.metadata.source} field ${resolveSourceKey(entry.propertyKey, entry.metadata.key)}.`,
            toFieldName(entry.propertyKey),
            entry.metadata.source,
          ),
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
