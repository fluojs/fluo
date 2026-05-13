import { type Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import type { Container, Provider } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';

/**
 * Describes the discovery candidate contract.
 */
export interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
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
  first: { moduleName: string; targetType: Function },
  second: { moduleName: string; targetType: Function },
): string {
  return `Duplicate ${kind} handler for ${messageType.name} was discovered in ${first.moduleName}.${first.targetType.name} and ${second.moduleName}.${second.targetType.name}.`;
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
        }
      }

      for (const controller of compiledModule.definition.controllers ?? []) {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(controller),
          targetType: controller,
          token: controller,
        });
      }
    }

    return candidates;
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
