import { formatTokenName, type Token } from '@fluojs/core';
import type { Container, Provider } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';
import { getRuntimeClassDiMetadata } from '@fluojs/runtime/internal';

import { getCommandHandlerMetadata } from './metadata.js';
import { getEventHandlerMetadata } from './metadata.js';
import { getQueryHandlerMetadata } from './metadata.js';
import { getSagaMetadata } from './metadata.js';

/**
 * Describes the discovery candidate contract.
 */
export interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

interface ProviderDiscoveryCandidate {
  moduleName: string;
  provider: Provider;
}

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getRuntimeClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getRuntimeClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function isFactoryOrValueProvider(
  provider: Provider,
): provider is Extract<Provider, { useFactory: unknown } | { useValue: unknown }> {
  return typeof provider === 'object' && provider !== null && ('useFactory' in provider || 'useValue' in provider);
}

function hasCqrsMetadata(targetType: Function): boolean {
  return (
    getCommandHandlerMetadata(targetType) !== undefined ||
    getQueryHandlerMetadata(targetType) !== undefined ||
    getEventHandlerMetadata(targetType) !== undefined ||
    getSagaMetadata(targetType) !== undefined
  );
}

/**
 * Create duplicate handler message.
 *
 * @param kind The kind.
 * @param messageType The message type.
 * @param first The first.
 * @param second The second.
 * @returns The create duplicate handler message result.
 */
export function createDuplicateHandlerMessage(
  kind: 'command' | 'query' | 'event',
  messageType: Function,
  first: { moduleName: string; targetType: Function; token: Token },
  second: { moduleName: string; targetType: Function; token: Token },
): string {
  return `Duplicate ${kind} handler for ${messageType.name} was discovered in ${describeHandlerRegistration(first)} and ${describeHandlerRegistration(second)}.`;
}

function describeHandlerRegistration(registration: { moduleName: string; targetType: Function; token: Token }): string {
  return `${registration.moduleName}.${registration.targetType.name} [token: ${formatTokenName(registration.token)}]`;
}

/**
 * Checks whether two discovered handler candidates refer to the same provider registration.
 *
 * @param first The first handler registration.
 * @param second The second handler registration.
 * @returns Whether both target type and provider token match.
 */
export function isSameHandlerRegistration(
  first: { targetType: Function; token: Token },
  second: { targetType: Function; token: Token },
): boolean {
  return first.targetType === second.targetType && first.token === second.token;
}

/**
 * Represents the cqrs bus base.
 */
export abstract class CqrsBusBase {
  protected readonly handlerInstances = new Map<Token, Promise<unknown>>();

  constructor(
    protected readonly runtimeContainer: Container,
    protected readonly compiledModules: readonly CompiledModule[],
    protected readonly logger: ApplicationLogger,
  ) {}

  protected discoveryCandidates(): DiscoveryCandidate[] {
    const candidates: DiscoveryCandidate[] = [];
    const providerCandidates: ProviderDiscoveryCandidate[] = [];

    for (const compiledModule of this.compiledModules) {
      for (const provider of compiledModule.definition.providers ?? []) {
        if (typeof provider === 'function') {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider),
            targetType: provider,
            token: provider,
          });
          continue;
        }

        if (isClassProvider(provider)) {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider),
            targetType: provider.useClass,
            token: provider.provide,
          });
          continue;
        }

        if (isFactoryOrValueProvider(provider)) {
          providerCandidates.push({ moduleName: compiledModule.type.name, provider });
        }
      }
    }

    for (const candidate of providerCandidates) {
      const resolvedCandidate = this.resolveProviderDiscoveryCandidate(candidate);

      if (resolvedCandidate) {
        candidates.push(resolvedCandidate);
      }
    }

    return candidates;
  }

  private resolveProviderDiscoveryCandidate(candidate: ProviderDiscoveryCandidate): DiscoveryCandidate | undefined {
    const provider = candidate.provider;

    if (!('provide' in provider)) {
      return undefined;
    }

    const scope = scopeFromProvider(provider);
    const token = provider.provide;

    if (scope !== 'singleton') {
      return this.createUnresolvedProviderDiscoveryCandidate(candidate.moduleName, token, scope);
    }

    if ('useValue' in provider) {
      const instance = provider.useValue;

      if (typeof instance !== 'object' || instance === null) {
        return undefined;
      }

      const targetType = instance.constructor;

      if (typeof targetType !== 'function' || !hasCqrsMetadata(targetType)) {
        return undefined;
      }

      return {
        moduleName: candidate.moduleName,
        scope,
        targetType,
        token,
      };
    }

    if (typeof token !== 'function' || !hasCqrsMetadata(token)) {
      return undefined;
    }

    return {
      moduleName: candidate.moduleName,
      scope,
      targetType: token,
      token,
    };
  }

  private createUnresolvedProviderDiscoveryCandidate(
    moduleName: string,
    token: Token,
    scope: 'request' | 'transient',
  ): DiscoveryCandidate | undefined {
    const tokenType = typeof token === 'function' ? token : undefined;

    if (!tokenType) {
      return undefined;
    }

    return {
      moduleName,
      scope,
      targetType: tokenType,
      token,
    };
  }

  protected async preloadHandlerInstance(token: Token): Promise<void> {
    if (this.handlerInstances.has(token)) {
      return;
    }

    const resolving = this.runtimeContainer.resolve(token);
    this.handlerInstances.set(token, resolving);

    try {
      await resolving;
    } catch (error) {
      this.handlerInstances.delete(token);
      throw error;
    }
  }

  protected async resolveHandlerInstance(token: Token): Promise<unknown> {
    const cached = this.handlerInstances.get(token);

    if (cached) {
      return await cached;
    }

    const resolving = this.runtimeContainer.resolve(token);
    this.handlerInstances.set(token, resolving);

    try {
      return await resolving;
    } catch (error) {
      this.handlerInstances.delete(token);
      throw error;
    }
  }
}
