import { formatTokenName, InvariantError, type Token } from '@fluojs/core';
import type { Container, NormalizedProvider, Provider } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';

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

function providerToken(provider: Provider): Token {
  return typeof provider === 'function' ? provider : provider.provide;
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
 * Filters discovery candidates so that tokens duplicated across different handler classes
 * retain only the winning provider identity registered in the application container,
 * preserving deduplication and distinct token visibility while preventing superseded
 * handler classes from resolving to the winning provider instance.
 *
 * @param candidates Candidates extracted from compiled modules.
 * @returns Effective candidates with duplicate token conflicts resolved to the winning provider.
 */
export function filterEffectiveDiscoveryCandidates(
  candidates: readonly DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const winningTargetTypeByToken = new Map<Token, Function>();

  for (const candidate of candidates) {
    winningTargetTypeByToken.set(candidate.token, candidate.targetType);
  }

  return candidates.filter((candidate) => candidate.targetType === winningTargetTypeByToken.get(candidate.token));
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

  protected async discoveryCandidates(): Promise<DiscoveryCandidate[]> {
    const moduleNamesByTokenAndType = new Map<Token, Map<Function, string>>();

    for (const compiledModule of this.compiledModules) {
      for (const provider of compiledModule.definition.providers ?? []) {
        const token = providerToken(provider);
        const targetType = this.moduleProviderTargetType(provider);

        if (!targetType || !hasCqrsMetadata(targetType)) {
          continue;
        }

        const namesByType = moduleNamesByTokenAndType.get(token) ?? new Map<Function, string>();
        namesByType.set(targetType, compiledModule.type.name);
        moduleNamesByTokenAndType.set(token, namesByType);
      }
    }

    const candidates: DiscoveryCandidate[] = [];

    const registrations = this.runtimeContainer.inspectResolutionState().registrations;

    for (const [token, moduleNamesByType] of moduleNamesByTokenAndType) {
      const provider = registrations.get(token);

      if (!provider) {
        continue;
      }

      const resolvedCandidate = await this.resolveEffectiveProviderDiscoveryCandidate(
        token,
        provider,
        moduleNamesByType,
      );

      if (resolvedCandidate) {
        candidates.push(resolvedCandidate);
      }
    }

    return candidates;
  }

  private moduleProviderTargetType(provider: Provider): Function | undefined {
    if (typeof provider === 'function') {
      return provider;
    }

    if ('useClass' in provider) {
      return provider.useClass;
    }

    if ('useFactory' in provider) {
      return typeof provider.provide === 'function' ? provider.provide : undefined;
    }

    if ('useValue' in provider && typeof provider.useValue === 'object' && provider.useValue !== null) {
      return provider.useValue.constructor;
    }

    return undefined;
  }

  private async resolveEffectiveProviderDiscoveryCandidate(
    token: Token,
    provider: NormalizedProvider,
    moduleNamesByType: ReadonlyMap<Function, string>,
  ): Promise<DiscoveryCandidate | undefined> {
    const targetType = await this.resolveEffectiveProviderTargetType(token, provider, moduleNamesByType);

    if (!targetType || !hasCqrsMetadata(targetType)) {
      return undefined;
    }

    return {
      moduleName: moduleNamesByType.get(targetType) ?? 'RuntimeBootstrap',
      scope: provider.scope,
      targetType,
      token,
    };
  }

  private async resolveEffectiveProviderTargetType(
    token: Token,
    provider: NormalizedProvider,
    moduleNamesByType: ReadonlyMap<Function, string>,
  ): Promise<Function | undefined> {
    if (provider.type === 'class') {
      return provider.useClass;
    }

    if (provider.type === 'value') {
      if (typeof provider.useValue !== 'object' || provider.useValue === null) {
        return undefined;
      }

      return provider.useValue.constructor;
    }

    if (provider.type !== 'factory') {
      return undefined;
    }

    if (provider.scope !== 'singleton') {
      return moduleNamesByType.keys().next().value;
    }

    const instance = await this.runtimeContainer.resolve(token);

    if (typeof instance !== 'object' || instance === null) {
      return undefined;
    }

    return instance.constructor;
  }

  protected async preloadHandlerInstance(token: Token, expectedType?: Function): Promise<void> {
    if (this.handlerInstances.has(token)) {
      const existing = await this.handlerInstances.get(token);
      if (expectedType && !(existing instanceof expectedType)) {
        throw new InvariantError(
          `Resolved handler instance for ${formatTokenName(token)} is not an instance of ${expectedType.name}.`,
        );
      }
      return;
    }

    const resolving = this.runtimeContainer.resolve(token);
    this.handlerInstances.set(token, resolving);

    try {
      const instance = await resolving;
      if (expectedType && !(instance instanceof expectedType)) {
        throw new InvariantError(
          `Resolved handler instance for ${formatTokenName(token)} is not an instance of ${expectedType.name}.`,
        );
      }
    } catch (error) {
      this.handlerInstances.delete(token);
      throw error;
    }
  }

  protected async resolveHandlerInstance(token: Token, expectedType?: Function): Promise<unknown> {
    const cached = this.handlerInstances.get(token);

    if (cached) {
      const instance = await cached;
      if (expectedType && !(instance instanceof expectedType)) {
        throw new InvariantError(
          `Resolved handler instance for ${formatTokenName(token)} is not an instance of ${expectedType.name}.`,
        );
      }
      return instance;
    }

    const resolving = this.runtimeContainer.resolve(token);
    this.handlerInstances.set(token, resolving);

    try {
      const instance = await resolving;
      if (expectedType && !(instance instanceof expectedType)) {
        throw new InvariantError(
          `Resolved handler instance for ${formatTokenName(token)} is not an instance of ${expectedType.name}.`,
        );
      }
      return await resolving;
    } catch (error) {
      this.handlerInstances.delete(token);
      throw error;
    }
  }
}
