import { readFirstNonEmptyRequestHeaderValue } from '../header-helpers.js';
import type {
  ConditionalRequestContext,
  ConditionalRequestOptions,
  EntityTag,
  FrameworkResponse,
  ResponseValidators,
} from '../types.js';

export type ConditionalRequestOutcome = 'not-modified' | 'precondition-failed' | 'proceed';

/** Result of one dispatcher-owned conditional request evaluation. */
export interface ConditionalRequestResult {
  /** Whether dispatch continues, produces 304, or produces 412. */
  readonly outcome: ConditionalRequestOutcome;
  /** Current representation validators that must remain visible to adapters. */
  readonly validators: ResponseValidators | undefined;
}

function formatEntityTag(tag: EntityTag): string {
  return `${tag.strength === 'weak' ? 'W/' : ''}"${tag.opaqueValue}"`;
}

function parseEntityTag(value: string): EntityTag | undefined {
  const match = /^(W\/)?"([^"]*)"$/.exec(value.trim());

  if (!match) {
    return undefined;
  }

  return {
    opaqueValue: match[2] ?? '',
    strength: match[1] === 'W/' ? 'weak' : 'strong',
  };
}

function matchesEntityTag(
  header: string,
  current: EntityTag | undefined,
  comparison: EntityTag['strength'] | 'weak',
  resourceExists: boolean,
): boolean {
  if (header.trim() === '*') {
    return resourceExists;
  }

  if (!current) {
    return false;
  }

  return header.split(',').some((candidate) => {
    const requested = parseEntityTag(candidate);

    if (!requested || requested.opaqueValue !== current.opaqueValue) {
      return false;
    }

    return comparison === 'weak' || (requested.strength === 'strong' && current.strength === 'strong');
  });
}

function parseHttpDate(header: string | undefined): number | undefined {
  if (!header) {
    return undefined;
  }

  const timestamp = Date.parse(header);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function normalizeLastModified(lastModified: Date | undefined): number | undefined {
  if (!lastModified || Number.isNaN(lastModified.getTime())) {
    return undefined;
  }

  return Math.floor(lastModified.getTime() / 1_000) * 1_000;
}

function isSafeMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

/**
 * Resolve the RFC validator precedence result before the selected route executes.
 *
 * @param options Dispatcher conditional request configuration.
 * @param context Matched request and route descriptor.
 * @returns The dispatch outcome and validators to preserve in the response.
 */
export async function resolveConditionalRequest(
  options: ConditionalRequestOptions,
  context: ConditionalRequestContext,
): Promise<ConditionalRequestResult> {
  const validators = await options.resolve(context);
  const ifMatch = readFirstNonEmptyRequestHeaderValue(context.request, 'if-match');

  if (ifMatch !== undefined) {
    return {
      outcome: matchesEntityTag(ifMatch, validators?.etag, 'strong', validators !== undefined)
        ? 'proceed'
        : 'precondition-failed',
      validators,
    };
  }

  const lastModified = normalizeLastModified(validators?.lastModified);
  const ifUnmodifiedSince = parseHttpDate(
    readFirstNonEmptyRequestHeaderValue(context.request, 'if-unmodified-since'),
  );

  if (ifUnmodifiedSince !== undefined && lastModified !== undefined && lastModified > ifUnmodifiedSince) {
    return { outcome: 'precondition-failed', validators };
  }

  const ifNoneMatch = readFirstNonEmptyRequestHeaderValue(context.request, 'if-none-match');

  if (ifNoneMatch !== undefined && matchesEntityTag(ifNoneMatch, validators?.etag, 'weak', validators !== undefined)) {
    return {
      outcome: isSafeMethod(context.request.method) ? 'not-modified' : 'precondition-failed',
      validators,
    };
  }

  const ifModifiedSince = parseHttpDate(
    readFirstNonEmptyRequestHeaderValue(context.request, 'if-modified-since'),
  );

  if (
    isSafeMethod(context.request.method)
    && ifNoneMatch === undefined
    && ifModifiedSince !== undefined
    && lastModified !== undefined
    && lastModified <= ifModifiedSince
  ) {
    return { outcome: 'not-modified', validators };
  }

  return { outcome: 'proceed', validators };
}

/**
 * Applies selected response validators through the portable response facade.
 *
 * @param response Mutable adapter-normalized response.
 * @param validators Current representation validators, when available.
 * @returns Nothing. The response receives only validator metadata.
 */
export function applyResponseValidators(
  response: FrameworkResponse,
  validators: ResponseValidators | undefined,
): void {
  if (validators?.etag) {
    response.setHeader('ETag', formatEntityTag(validators.etag));
  }

  const lastModified = normalizeLastModified(validators?.lastModified);

  if (lastModified !== undefined) {
    response.setHeader('Last-Modified', new Date(lastModified).toUTCString());
  }
}

/**
 * Writes a bodyless conditional response through every supported adapter facade.
 *
 * @param response Mutable adapter-normalized response.
 * @param outcome Selected non-proceed conditional request outcome.
 * @param validators Current representation validators.
 * @returns A promise that settles after the adapter accepts the bodyless response.
 */
export async function writeConditionalResponse(
  response: FrameworkResponse,
  outcome: Exclude<ConditionalRequestOutcome, 'proceed'>,
  validators: ResponseValidators | undefined,
): Promise<void> {
  applyResponseValidators(response, validators);
  response.setStatus(outcome === 'not-modified' ? 304 : 412);
  await response.send(undefined);
}
