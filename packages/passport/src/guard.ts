import { ForbiddenException, UnauthorizedException, type GuardContext } from '@konekti/http';
import type { Principal } from '@konekti/http';
import { Inject, type Token } from '@konekti/core';
import { ContainerResolutionError } from '@konekti/di';

import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
  AuthStrategyResolutionError,
} from './errors.js';
import { AUTH_STRATEGY_REGISTRY, PASSPORT_OPTIONS } from './internal-tokens.js';
import { getAuthRequirement } from './metadata.js';
import {
  type AuthGuardContract,
  type AuthHandledResult,
  type AuthStrategy,
  type AuthStrategyResult,
  type AuthStrategyRegistry,
  type PassportModuleOptions,
} from './types.js';

function isAuthHandledResult(result: AuthStrategyResult): result is AuthHandledResult {
  return typeof result === 'object' && result !== null && 'handled' in result && result.handled === true;
}

function resolvePrincipal(result: AuthStrategyResult): Principal | undefined {
  if (isAuthHandledResult(result)) {
    return result.principal;
  }

  return result;
}

function hasRequiredScopes(principal: { scopes?: string[] }, scopes: string[]): boolean {
  return scopes.every((scope) => principal.scopes?.includes(scope));
}

function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof AuthenticationRequiredError
    || error instanceof AuthenticationExpiredError
    || error instanceof AuthenticationFailedError
  );
}

function hasRegisteredStrategy(registry: AuthStrategyRegistry, strategyName: string): boolean {
  return  Object.hasOwn(registry, strategyName);
}

@Inject([AUTH_STRATEGY_REGISTRY, PASSPORT_OPTIONS])
export class AuthGuard implements AuthGuardContract {
  constructor(
    private readonly strategies: AuthStrategyRegistry = {},
    private readonly options: PassportModuleOptions = {},
  ) {}

  async canActivate(context: GuardContext): Promise<true> {
    const requirement = getAuthRequirement(context.handler.controllerToken, context.handler.methodName);
    const strategyName = requirement?.strategy ?? this.options.defaultStrategy;

    if (!strategyName) {
      if (requirement?.scopes?.length) {
        throw new AuthStrategyResolutionError('Auth requirement exists without an active strategy.');
      }

      return true;
    }

    if (!hasRegisteredStrategy(this.strategies, strategyName)) {
      throw new AuthStrategyResolutionError(`No auth strategy registered for ${strategyName}.`);
    }

    const strategyToken = this.strategies[strategyName];

    const strategy = await context.requestContext.container.resolve(strategyToken as Token<AuthStrategy>).catch((error: unknown) => {
      if (error instanceof ContainerResolutionError) {
        throw new AuthStrategyResolutionError(`Failed to resolve auth strategy "${strategyName}": ${error.message}`);
      }

      throw error;
    });

    try {
      const result = await strategy.authenticate(context);
      const principal = resolvePrincipal(result);

      if (isAuthHandledResult(result) && !principal) {
        if (!context.requestContext.response.committed) {
          throw new AuthenticationFailedError(
            'Auth strategy returned handled:true without a principal but did not commit a response.',
          );
        }

        return true;
      }

      if (!principal) {
        throw new AuthenticationFailedError('Authentication strategy did not return a principal.');
      }

      if (requirement?.scopes?.length && !hasRequiredScopes(principal, requirement.scopes)) {
        throw new ForbiddenException('Access denied.');
      }

      context.requestContext.principal = principal;
      return true;
    } catch (error: unknown) {
      if (isAuthenticationFailure(error)) {
        throw new UnauthorizedException('Authentication required.', { cause: error });
      }

      throw error;
    }
  }
}
