import { readFirstNonEmptyRequestHeaderValue } from '../header-helpers.js';
import type {
  ConditionalRequestOptions,
  ConditionalRequestValidators,
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  RequestContext,
} from '../types.js';
import {
  generateEntityTag,
  matchesEntityTag,
  parseEntityTag,
  parseEntityTagList,
} from './entity-tag.js';

type ConditionalOutcome = 304 | 412;

interface ResolvedValidators {
  readonly etag?: string;
  readonly exists: boolean;
  readonly lastModified?: string;
}

export async function tryHandleConditionalRequestBeforeHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  options: ConditionalRequestOptions | undefined,
): Promise<boolean> {
  if (options?.resolve === undefined) {
    return false;
  }

  for (const header of handler.route.headers ?? []) {
    requestContext.response.setHeader(header.name, header.value);
  }

  const configured = await options.resolve({ handler, requestContext });
  if (configured === undefined) {
    return false;
  }

  const validators = applyConfiguredValidators(requestContext.response, configured);
  const outcome = evaluateConditionalRequest(requestContext.request, validators);

  return outcome === undefined
    ? false
    : await writeConditionalOutcome(requestContext.response, outcome);
}

export async function tryHandleConditionalResponse(
  request: FrameworkRequest,
  response: FrameworkResponse,
  value: unknown,
  options: ConditionalRequestOptions | undefined,
): Promise<boolean> {
  if (options === undefined) {
    return false;
  }

  normalizeLastModifiedHeader(response);

  if (
    options.etag !== undefined
    && readResponseHeader(response, 'etag') === undefined
    && canGenerateEntityTag(response, value)
  ) {
    const generated = await generateEntityTag(
      value,
      readResponseHeader(response, 'content-type'),
      options.etag,
    );

    if (generated !== undefined) {
      response.setHeader('ETag', generated);
    }
  }

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  const outcome = evaluateConditionalRequest(request, readResponseValidators(response));
  return outcome === undefined ? false : await writeConditionalOutcome(response, outcome);
}

function applyConfiguredValidators(
  response: FrameworkResponse,
  validators: ConditionalRequestValidators,
): ResolvedValidators {
  if (validators.etag !== undefined) {
    response.setHeader('ETag', validators.etag);
  }

  const lastModified = normalizeHttpDate(validators.lastModified);
  if (lastModified !== undefined) {
    response.setHeader('Last-Modified', lastModified);
  }

  return {
    etag: readResponseHeader(response, 'etag'),
    exists: validators.exists ?? true,
    lastModified: normalizeLastModifiedHeader(response),
  };
}

function readResponseValidators(response: FrameworkResponse): ResolvedValidators {
  return {
    etag: readResponseHeader(response, 'etag'),
    exists: true,
    lastModified: normalizeLastModifiedHeader(response),
  };
}

function evaluateConditionalRequest(
  request: FrameworkRequest,
  validators: ResolvedValidators,
): ConditionalOutcome | undefined {
  const currentEntityTag = parseEntityTag(validators.etag);
  const ifMatchValue = readFirstNonEmptyRequestHeaderValue(request, 'if-match');

  if (ifMatchValue !== undefined) {
    const ifMatch = parseEntityTagList(ifMatchValue);
    if (
      ifMatch !== undefined
      && !matchesEntityTag(currentEntityTag, ifMatch, validators.exists, 'strong')
    ) {
      return 412;
    }
  } else {
    const ifUnmodifiedSince = parseHttpDateHeader(request, 'if-unmodified-since');
    const lastModified = parseNormalizedHttpDate(validators.lastModified);

    if (
      ifUnmodifiedSince !== undefined
      && lastModified !== undefined
      && lastModified > ifUnmodifiedSince
    ) {
      return 412;
    }
  }

  const method = request.method.toUpperCase();
  const isRetrieval = method === 'GET' || method === 'HEAD';
  const ifNoneMatchValue = readFirstNonEmptyRequestHeaderValue(request, 'if-none-match');

  if (ifNoneMatchValue !== undefined) {
    const ifNoneMatch = parseEntityTagList(ifNoneMatchValue);
    if (
      ifNoneMatch !== undefined
      && matchesEntityTag(currentEntityTag, ifNoneMatch, validators.exists, 'weak')
    ) {
      return isRetrieval ? 304 : 412;
    }

    return undefined;
  }

  if (!isRetrieval) {
    return undefined;
  }

  const ifModifiedSince = parseHttpDateHeader(request, 'if-modified-since');
  const lastModified = parseNormalizedHttpDate(validators.lastModified);

  return (
    ifModifiedSince !== undefined
    && lastModified !== undefined
    && lastModified <= ifModifiedSince
  )
    ? 304
    : undefined;
}

async function writeConditionalOutcome(
  response: FrameworkResponse,
  status: ConditionalOutcome,
): Promise<true> {
  response.setStatus(status);
  await response.send(undefined);
  return true;
}

function canGenerateEntityTag(response: FrameworkResponse, value: unknown): boolean {
  const status = response.statusCode ?? 200;
  return (
    value !== undefined
    && status >= 200
    && status < 300
    && status !== 204
    && status !== 205
    && !hasNoStoreDirective(response)
  );
}

function hasNoStoreDirective(response: FrameworkResponse): boolean {
  const cacheControl = readResponseHeader(response, 'cache-control');

  return cacheControl
    ?.split(',')
    .some((directive) => directive.trim().split('=', 1)[0]?.toLowerCase() === 'no-store') === true;
}

function normalizeLastModifiedHeader(response: FrameworkResponse): string | undefined {
  const normalized = normalizeHttpDate(readResponseHeader(response, 'last-modified'));

  if (normalized !== undefined) {
    response.setHeader('Last-Modified', normalized);
  }

  return normalized;
}

function normalizeHttpDate(value: Date | number | string | undefined): string | undefined {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value ?? '');

  return Number.isFinite(timestamp)
    ? new Date(Math.floor(timestamp / 1000) * 1000).toUTCString()
    : undefined;
}

function parseHttpDateHeader(request: FrameworkRequest, name: string): number | undefined {
  return parseNormalizedHttpDate(readFirstNonEmptyRequestHeaderValue(request, name));
}

function parseNormalizedHttpDate(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) * 1000 : undefined;
}

function readResponseHeader(response: FrameworkResponse, name: string): string | undefined {
  const entry = Object.entries(response.headers)
    .find(([headerName]) => headerName.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];

  return Array.isArray(value) ? value.join(',') : value;
}
