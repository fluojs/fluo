import type { Container, Provider } from '@fluojs/di';
import type { Token } from '@fluojs/core';
import { resolveMultiContribution } from '@fluojs/di/internal';

import { providerToken } from '../module-graph.js';
import type { RuntimePlatformShell } from '../platform-shell.js';
import { createLifecycleCloseError } from '../retryable-shutdown.js';
import type { BootstrapReadySignal } from '../tokens.js';
import type { ApplicationLogger, BootstrapResult, CompiledModule, OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown } from '../types.js';
import { isDirectSingletonContextProvider, isMultiProvider } from './provider-policy.js';

/**
 * Factory-owned readiness settlement for bootstrap consumers.
 *
 * @internal
 */
export type MutableBootstrapReadySignal = BootstrapReadySignal & {
  markFailed(error: unknown): void;
  markReady(): void;
};

/**
 * Recognizes callable lifecycle and transport capabilities.
 *
 * @internal
 * @param value Candidate capability owner.
 * @param methodName Required callable capability.
 * @returns Whether the capability is callable.
 */
export function hasMethod<TName extends string>(
  value: unknown,
  methodName: TName,
): value is Record<TName, (...args: never[]) => unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)[methodName] === 'function';
}

function isOnModuleInit(value: unknown): value is OnModuleInit {
  return hasMethod(value, 'onModuleInit');
}

function isOnApplicationBootstrap(value: unknown): value is OnApplicationBootstrap {
  return hasMethod(value, 'onApplicationBootstrap');
}

function isOnModuleDestroy(value: unknown): value is OnModuleDestroy {
  return hasMethod(value, 'onModuleDestroy');
}

function isOnApplicationShutdown(value: unknown): value is OnApplicationShutdown {
  return hasMethod(value, 'onApplicationShutdown');
}

function hasReadinessStateMethods(value: unknown): value is { markReady(): void; markStarting(): void } {
  if (typeof value !== 'function') {
    return false;
  }

  const readinessAware = value as Function & { markReady?: unknown; markStarting?: unknown };

  return typeof readinessAware.markReady === 'function' && typeof readinessAware.markStarting === 'function';
}

/**
 * Returns readiness-aware compiled modules to starting state.
 *
 * @internal
 * @param modules Compiled modules retaining authored identities.
 */
export function resetReadinessState(modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    if (hasReadinessStateMethods(compiledModule.type)) {
      compiledModule.type.markStarting();
    }
  }
}

function markReadinessState(modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    if (hasReadinessStateMethods(compiledModule.type)) {
      compiledModule.type.markReady();
    }
  }
}

/**
 * lifecycle hook이 있는 singleton provider 인스턴스를 미리 해석해 둔다.
 */
async function resolveLifecycleInstances(
  container: Container,
  providers: Provider[],
  resolvedInstances: unknown[] = [],
): Promise<unknown[]> {
  const lifecycleEntries: Array<{ contributionIndex?: number; token: Token; useValue?: unknown }> = [];
  const seenSingleTokens = new Set<Token>();
  const multiContributionIndexes = new Map<Token, number>();

  for (const provider of providers) {
    const token = providerToken(provider);

    if (isMultiProvider(provider)) {
      const contributionIndex = multiContributionIndexes.get(token) ?? 0;
      multiContributionIndexes.set(token, contributionIndex + 1);

      if (isHookBearingValueProvider(provider)) {
        lifecycleEntries.push({ token, useValue: provider.useValue });
        continue;
      }

      if (isDirectSingletonContextProvider(provider, true)) {
        lifecycleEntries.push({ contributionIndex, token });
      }

      continue;
    }

    if (seenSingleTokens.has(token)) {
      continue;
    }

    if (isHookBearingValueProvider(provider)) {
      seenSingleTokens.add(token);
      lifecycleEntries.push({ token, useValue: provider.useValue });
      continue;
    }

    if (!isDirectSingletonContextProvider(provider)) {
      continue;
    }

    seenSingleTokens.add(token);
    lifecycleEntries.push({ token });
  }

  const resolutionResults = await Promise.allSettled(
    lifecycleEntries.map((entry) => {
      if (entry.useValue !== undefined) {
        return entry.useValue;
      }

      if (entry.contributionIndex === undefined) {
        return container.resolve(entry.token);
      }

      return resolveMultiContribution(container, entry.token, entry.contributionIndex);
    }),
  );

  let resolutionError: unknown;
  let hasResolutionError = false;

  for (const [index, result] of resolutionResults.entries()) {
    if (result.status === 'fulfilled') {
      const entry = lifecycleEntries[index];

      if (entry.contributionIndex === undefined || hasLifecycleHook(result.value)) {
        resolvedInstances.push(result.value);
      }

      continue;
    }

    if (!hasResolutionError) {
      resolutionError = result.reason;
      hasResolutionError = true;
    }
  }

  if (hasResolutionError) {
    throw resolutionError;
  }

  return resolvedInstances;
}

function isHookBearingValueProvider(provider: Provider): provider is Provider & { useValue: unknown } {
  return typeof provider === 'object'
    && provider !== null
    && 'useValue' in provider
    && hasLifecycleHook(provider.useValue);
}

function hasLifecycleHook(value: unknown): boolean {
  return isOnModuleInit(value)
    || isOnApplicationBootstrap(value)
    || isOnModuleDestroy(value)
    || isOnApplicationShutdown(value);
}

/**
 * 부트스트랩 단계의 hook을 고정된 순서로 실행한다.
 */
async function runBootstrapHooks(instances: unknown[]): Promise<void> {
  for (const instance of instances) {
    if (isOnModuleInit(instance)) {
      await instance.onModuleInit();
    }
  }

  for (const instance of instances) {
    if (isOnApplicationBootstrap(instance)) {
      await instance.onApplicationBootstrap();
    }
  }
}

/**
 * 종료 단계의 hook을 역순으로 실행해 이미 시작한 리소스를 정리한다.
 *
 * @internal
 * @param instances Instances in provider/contribution order.
 * @param signal Caller-owned shutdown reason.
 * @returns Settlement after both reverse-order hook passes have been attempted.
 */
export async function runShutdownHooks(instances: readonly unknown[], signal?: string): Promise<void> {
  const errors: unknown[] = [];

  for (const instance of [...instances].reverse()) {
    try {
      if (isOnModuleDestroy(instance)) {
        await instance.onModuleDestroy();
      }
    } catch (error) {
      errors.push(error);
    }
  }

  for (const instance of [...instances].reverse()) {
    try {
      if (isOnApplicationShutdown(instance)) {
        await instance.onApplicationShutdown(signal);
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw createLifecycleCloseError(errors);
  }
}

/**
 * Runs ordered startup hooks before platform start and readiness publication.
 *
 * @internal
 * @param modules Compiled modules retaining authored identities.
 * @param lifecycleInstances Settled lifecycle instances in provider order.
 * @param logger Application logger preserving caller identity.
 * @param platformShell Platform-owned lifecycle coordinator.
 * @param bootstrapReadySignal Factory readiness settlement.
 * @returns Settlement of the runtime-owned operation.
 */
export async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
  bootstrapReadySignal: MutableBootstrapReadySignal,
): Promise<void> {
  resetReadinessState(modules);
  await runBootstrapHooks(lifecycleInstances);
  await platformShell.start();
  markReadinessState(modules);
  bootstrapReadySignal.markReady();
  logCompiledModules(logger, modules);
}

/**
 * Settles eligible provider contributions before ordered lifecycle execution.
 *
 * @internal
 * @param bootstrapped Compiled graph and its owning container.
 * @param resolvedInstances Already acquired instances retained for partial-failure cleanup.
 * @returns Settlement of the runtime-owned operation.
 */
export async function resolveBootstrapLifecycleInstances(
  bootstrapped: BootstrapResult,
  resolvedInstances?: unknown[],
): Promise<unknown[]> {
  const lifecycleProviders = [
    ...bootstrapped.effectiveProviders.runtimeProviders,
    ...bootstrapped.effectiveProviders.moduleProviders,
  ];

  return resolveLifecycleInstances(bootstrapped.container, lifecycleProviders, resolvedInstances);
}

function logCompiledModules(logger: ApplicationLogger, modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    logger.log(`${compiledModule.type.name} dependencies initialized`, 'InstanceLoader');
  }
}
