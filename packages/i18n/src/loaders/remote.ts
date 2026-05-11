import { I18nError } from '../errors.js';
import type { I18nLocale, I18nMessageTree, I18nTranslationKey } from '../types.js';
import {
  isPlainObject,
  snapshotLoaderMessageTree,
  validateLoaderLocale,
  validateLoaderNamespace,
} from './shared.js';
import type { I18nLoader, I18nLoaderLoadOptions } from './shared.js';

export type { I18nLoader, I18nLoaderLoadOptions } from './shared.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Request metadata passed to a remote catalog provider.
 */
export interface RemoteI18nCatalogRequest {
  /** Locale identifier requested by the loader caller. */
  readonly locale: I18nLocale;
  /** Namespace identifier requested by the loader caller. */
  readonly namespace: I18nTranslationKey;
  /** Cancellation signal owned by the loader for timeout and caller abort propagation. */
  readonly signal: AbortSignal;
}

/**
 * Provider abstraction for remote JSON catalog backends such as HTTP APIs, object stores, or databases.
 */
export type RemoteI18nCatalogProvider = (request: RemoteI18nCatalogRequest) => Promise<unknown> | unknown;

/**
 * Options for provider-backed remote catalog loading.
 */
export interface RemoteI18nLoaderOptions {
  /** Backend provider that returns one raw catalog object or JSON string for the requested locale and namespace. */
  readonly provider: RemoteI18nCatalogProvider;
  /** Maximum load duration in milliseconds before the loader aborts and throws `I18N_LOADER_TIMEOUT`. */
  readonly timeoutMs?: number;
}

function validateTimeout(timeoutMs: unknown): number {
  if (timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new I18nError('Remote i18n loader timeoutMs must be a positive integer when provided.', 'I18N_INVALID_LOADER_OPTIONS');
  }

  return timeoutMs;
}

function parseRemoteCatalog(value: unknown, locale: I18nLocale, namespace: I18nTranslationKey): I18nMessageTree {
  if (value === undefined || value === null) {
    throw new I18nError(`Missing remote i18n catalog: ${locale}/${namespace}`, 'I18N_MISSING_CATALOG');
  }

  if (typeof value === 'string') {
    try {
      return snapshotLoaderMessageTree(JSON.parse(value), `catalogs.${locale}.${namespace}`);
    } catch (error) {
      if (error instanceof I18nError) {
        throw error;
      }

      throw new I18nError(`Malformed remote i18n catalog JSON: ${locale}/${namespace}`, 'I18N_INVALID_CATALOG');
    }
  }

  return snapshotLoaderMessageTree(value, `catalogs.${locale}.${namespace}`);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new I18nError('Remote i18n catalog load was aborted.', 'I18N_LOADER_ABORTED');
  }
}

function createTimeoutError(): I18nError {
  return new I18nError('Remote i18n catalog load timed out.', 'I18N_LOADER_TIMEOUT');
}

function createAbortError(): I18nError {
  return new I18nError('Remote i18n catalog load was aborted.', 'I18N_LOADER_ABORTED');
}

function createProviderError(error: unknown): I18nError {
  if (error instanceof I18nError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'Unknown provider failure';
  return new I18nError(`Remote i18n catalog provider failed: ${message}`, 'I18N_LOADER_FAILED');
}

function linkCallerAbort(callerSignal: AbortSignal | undefined, controller: AbortController): () => void {
  if (callerSignal === undefined) {
    return () => undefined;
  }

  if (callerSignal.aborted) {
    controller.abort(createAbortError());
    return () => undefined;
  }

  const abort = (): void => controller.abort(createAbortError());
  callerSignal.addEventListener('abort', abort, { once: true });
  return () => callerSignal.removeEventListener('abort', abort);
}

/**
 * Provider-backed remote JSON catalog loader for `@fluojs/i18n/loaders/remote`.
 *
 * @remarks
 * The loader validates locale and namespace before calling the provider, propagates cancellation through an
 * `AbortSignal`, enforces a per-load timeout, parses JSON strings, validates message tree shape, and always
 * returns a detached immutable catalog snapshot.
 */
export class RemoteI18nLoader implements I18nLoader {
  private readonly provider: RemoteI18nCatalogProvider;
  private readonly timeoutMs: number;

  /**
   * Creates a provider-backed remote catalog loader.
   *
   * @param options Remote loader options with a provider and optional timeout.
   */
  constructor(options: RemoteI18nLoaderOptions) {
    if (!isPlainObject(options) || typeof options.provider !== 'function') {
      throw new I18nError('Remote i18n loader provider must be a function.', 'I18N_INVALID_LOADER_OPTIONS');
    }

    this.provider = options.provider;
    this.timeoutMs = validateTimeout(options.timeoutMs);
  }

  /**
   * Loads and validates one remote message catalog through the configured provider.
   *
   * @param locale Locale identifier passed to the provider.
   * @param namespace Namespace identifier passed to the provider.
   * @param options Optional per-load cancellation controls.
   * @returns A detached immutable i18n message tree.
   * @throws {I18nError} When inputs are unsafe, the provider misses/fails, loading times out, JSON is malformed, or catalog shape is invalid.
   */
  async load(locale: I18nLocale, namespace: I18nTranslationKey, options: I18nLoaderLoadOptions = {}): Promise<I18nMessageTree> {
    validateLoaderLocale(locale, 'Remote i18n');
    validateLoaderNamespace(namespace, 'Remote i18n');

    const controller = new AbortController();
    const unlinkCallerAbort = linkCallerAbort(options.signal, controller);
    const timeout = setTimeout(() => controller.abort(createTimeoutError()), this.timeoutMs);
    const abortRace = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(controller.signal.reason instanceof I18nError ? controller.signal.reason : createAbortError()),
        { once: true },
      );
    });

    try {
      throwIfAborted(controller.signal);
      const rawCatalog = await Promise.race([Promise.resolve(this.provider({ locale, namespace, signal: controller.signal })), abortRace]);
      throwIfAborted(controller.signal);
      return parseRemoteCatalog(rawCatalog, locale, namespace);
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof I18nError) {
        throw controller.signal.reason;
      }

      throw createProviderError(error);
    } finally {
      clearTimeout(timeout);
      unlinkCallerAbort();
    }
  }
}

/**
 * Creates a provider-backed remote JSON catalog loader.
 *
 * @param options Remote loader options with a provider and optional timeout.
 * @returns A remote i18n loader instance.
 */
export function createRemoteI18nLoader(options: RemoteI18nLoaderOptions): RemoteI18nLoader {
  return new RemoteI18nLoader(options);
}
