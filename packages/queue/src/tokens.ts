import type { Token } from '@fluojs/core';
import type { ModuleType } from '@fluojs/runtime';

import type { QueueLifecycleService } from './service.js';
import type { NormalizedQueueModuleOptions, Queue } from './types.js';

/** Runtime metadata that binds one queue registration to its compiled module graph. */
export interface QueueModuleContext {
  readonly moduleType: ModuleType;
  readonly scope: string;
}

const scopedQueueTokens = new Map<string, Token<Queue>>();
const scopedQueueLifecycleServiceTokens = new Map<string, Token<QueueLifecycleService>>();
const scopedQueueOptionsTokens = new Map<string, Token<NormalizedQueueModuleOptions>>();
const scopedQueueRedisClientTokens = new Map<string, Token<unknown>>();
const scopedQueueModuleContextTokens = new Map<string, Token<QueueModuleContext>>();

/**
 * Normalize an optional queue registration scope.
 *
 * @param scope Optional scope name supplied to {@link QueueModule.forRoot}.
 * @returns A trimmed non-empty scope name, or `undefined` for the default registration.
 * @throws When a provided scope contains only whitespace.
 */
export function normalizeQueueScope(scope?: string): string | undefined {
  if (scope === undefined) {
    return undefined;
  }

  const normalized = scope.trim();

  if (normalized.length === 0) {
    throw new Error('Queue scope must be a non-empty string when provided.');
  }

  return normalized;
}

function getScopedToken<T>(tokens: Map<string, Token<T>>, scope: string, description: string): Token<T> {
  const existing = tokens.get(scope);

  if (existing) {
    return existing;
  }

  const created = Symbol(`${description}:${scope}`) as Token<T>;
  tokens.set(scope, created);
  return created;
}

/** Queue-owned Redis client token consumed by the default queue registration. */
export const QUEUE_REDIS_CLIENT: Token<unknown> = Symbol.for('fluo.queue.redis-client');
/** Compatibility injection token for the queue facade returned by {@link QueueModule.forRoot}. */
export const QUEUE: Token<Queue> = Symbol.for('fluo.queue');
/** Injection token for normalized module defaults consumed by {@link QueueLifecycleService}. */
export const QUEUE_OPTIONS: Token<NormalizedQueueModuleOptions> = Symbol.for('fluo.queue.options');
/** Runtime module-context token consumed by the default queue registration. */
export const QUEUE_MODULE_CONTEXT: Token<QueueModuleContext> = Symbol.for('fluo.queue.module-context');

/**
 * Return the queue facade token for a default or explicitly scoped registration.
 *
 * @param scope Optional queue registration scope.
 * @returns The compatibility {@link QUEUE} token when omitted, or a stable token for the scoped queue facade.
 */
export function getQueueToken(scope?: string): Token<Queue> {
  const normalizedScope = normalizeQueueScope(scope);

  if (normalizedScope === undefined) {
    return QUEUE;
  }

  return getScopedToken(scopedQueueTokens, normalizedScope, 'fluo.queue');
}

/**
 * Return the lifecycle service token for a default or explicitly scoped queue registration.
 *
 * @param scope Optional queue registration scope.
 * @returns The default lifecycle-service token when omitted, or a stable token for the scoped lifecycle service.
 */
export function getQueueLifecycleServiceToken(scope?: string): Token<QueueLifecycleService> {
  const normalizedScope = normalizeQueueScope(scope);

  if (normalizedScope === undefined) {
    return QueueLifecycleServiceToken;
  }

  return getScopedToken(scopedQueueLifecycleServiceTokens, normalizedScope, 'fluo.queue.lifecycle-service');
}

/**
 * Return the normalized options token for a default or explicitly scoped queue registration.
 *
 * @param scope Optional queue registration scope.
 * @returns The default options token when omitted, or a stable token for scoped normalized options.
 */
export function getQueueOptionsToken(scope?: string): Token<NormalizedQueueModuleOptions> {
  const normalizedScope = normalizeQueueScope(scope);

  if (normalizedScope === undefined) {
    return QUEUE_OPTIONS;
  }

  return getScopedToken(scopedQueueOptionsTokens, normalizedScope, 'fluo.queue.options');
}

/**
 * Return the queue-owned Redis client token for a default or explicitly scoped registration.
 *
 * @param scope Optional queue registration scope.
 * @returns The default Redis client token when omitted, or a stable token for the scoped Redis dependency.
 */
export function getQueueRedisClientToken(scope?: string): Token<unknown> {
  const normalizedScope = normalizeQueueScope(scope);

  if (normalizedScope === undefined) {
    return QUEUE_REDIS_CLIENT;
  }

  return getScopedToken(scopedQueueRedisClientTokens, normalizedScope, 'fluo.queue.redis-client');
}

/**
 * Return the module-context token for a default or explicitly scoped queue registration.
 *
 * @param scope Optional queue registration scope.
 * @returns The default module-context token when omitted, or a stable token for scoped queue context.
 */
export function getQueueModuleContextToken(scope?: string): Token<QueueModuleContext> {
  const normalizedScope = normalizeQueueScope(scope);

  if (normalizedScope === undefined) {
    return QUEUE_MODULE_CONTEXT;
  }

  return getScopedToken(scopedQueueModuleContextTokens, normalizedScope, 'fluo.queue.module-context');
}

const QueueLifecycleServiceToken: Token<QueueLifecycleService> = Symbol.for('fluo.queue.lifecycle-service.default');
