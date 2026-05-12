import type { Token } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import type { HttpApplicationAdapter } from '@fluojs/http';

import type { ApplicationLogger } from './types.js';
import type { CompiledModule } from './types.js';
import type { RuntimeCleanupRegistration } from './types.js';
import type { PlatformShell } from './platform-contract.js';

/** Internal signal that resolves only after application bootstrap reaches runtime readiness. */
export interface BootstrapReadySignal {
  /** Waits until every bootstrap hook and runtime readiness transition has completed. */
  wait(): Promise<void>;
}

/**
 * Injection token for the application logger.
 */
export const APPLICATION_LOGGER: Token<ApplicationLogger> = Symbol.for('fluo.runtime.application-logger');

/**
 * Injection token for the runtime container.
 */
export const RUNTIME_CONTAINER: Token<Container> = Symbol('RUNTIME_CONTAINER');

/**
 * Injection token for the compiled module list.
 */
export const COMPILED_MODULES: Token<readonly CompiledModule[]> = Symbol('COMPILED_MODULES');

/**
 * Injection token for the HTTP application adapter.
 */
export const HTTP_APPLICATION_ADAPTER: Token<HttpApplicationAdapter> = Symbol('HTTP_APPLICATION_ADAPTER');

/**
 * Injection token for the platform shell.
 */
export const PLATFORM_SHELL: Token<PlatformShell> = Symbol('PLATFORM_SHELL');

/**
 * Internal injection token for registering runtime-owned cleanup callbacks.
 */
export const RUNTIME_CLEANUP_REGISTRATION: Token<RuntimeCleanupRegistration> = Symbol('RUNTIME_CLEANUP_REGISTRATION');

/** Internal injection token for integrations that must defer work until full runtime readiness. */
export const BOOTSTRAP_READY_SIGNAL: Token<BootstrapReadySignal> = Symbol('BOOTSTRAP_READY_SIGNAL');
