import { InvariantError, type Token } from '@fluojs/core';
import type { Container } from '@fluojs/di';

import { createRetryableShutdownState } from '../retryable-shutdown.js';
import type { ApplicationContext, CompiledModule, ModuleType } from '../types.js';
import { type ContextResolutionCache, type ContextCacheableTokens, installContextCacheInvalidation, resolveContextToken } from './context-resolution.js';
import { closeRuntimeResources, type RuntimeResources, type RuntimeCleanupCallback, type RuntimeShutdownPhase } from './runtime-resources.js';

/**
 * Adapterless shell owning provider admission and runtime teardown.
 *
 * @internal
 */
export class FluoApplicationContext implements ApplicationContext {
  private closed = false;
  private closeStarted = false;
  private closingPromise: Promise<void> | undefined;
  private readonly contextResolutionCache: ContextResolutionCache = new Map();
  private readonly runtimeShutdownState = createRetryableShutdownState<RuntimeShutdownPhase>();

  readonly container: Container;
  readonly modules: CompiledModule[];
  private readonly lifecycleInstances: unknown[];
  private readonly runtimeCleanup: RuntimeCleanupCallback[];

  constructor(
    resources: RuntimeResources,
    readonly rootModule: ModuleType,
    readonly bootstrapTiming: ApplicationContext['bootstrapTiming'],
    private readonly contextCacheableTokens: ContextCacheableTokens,
  ) {
    this.container = resources.container;
    this.modules = resources.modules;
    this.lifecycleInstances = resources.lifecycleInstances;
    this.runtimeCleanup = resources.runtimeCleanup;
    installContextCacheInvalidation(this.container, this.contextResolutionCache, this.contextCacheableTokens);
  }

  async get<T>(token: Token<T>): Promise<T> {
    if (this.closed) {
      return this.container.resolve(token);
    }

    this.assertProviderResolutionAllowed();
    const resolved = await resolveContextToken(
      this.container,
      token,
      this.contextCacheableTokens,
      this.contextResolutionCache,
    );
    this.assertProviderResolutionAllowed();

    return resolved;
  }

  private assertProviderResolutionAllowed(): void {
    if (this.closeStarted) {
      throw new InvariantError('Application context cannot resolve providers after shutdown has started.');
    }
  }

  async close(signal?: string): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.closingPromise) {
      await this.closingPromise;
      return;
    }

    this.closeStarted = true;
    this.closingPromise = (async () => {
      await closeRuntimeResources({
        container: this.container,
        lifecycleInstances: this.lifecycleInstances,
        modules: this.modules,
        runtimeCleanup: this.runtimeCleanup,
        shutdownState: this.runtimeShutdownState,
        signal,
      });
      this.closed = true;
    })();

    try {
      await this.closingPromise;
    } catch (error) {
      this.closingPromise = undefined;
      throw error;
    }
  }
}
