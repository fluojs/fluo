import { ForbiddenException, UnauthorizedException, type GuardContext } from '@konekti/http';
import type { Principal } from '@konekti/http';
import { Inject, type Token } from '@konekti/core';

import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
  AuthStrategyResolutionError,
} from './errors';
import { getAuthRequirement } from './metadata';
import {
  AUTH_STRATEGY_REGISTRY,
  PASSPORT_OPTIONS,
  type AuthGuardContract,
  type AuthHandledResult,
  type AuthStrategy,
  type AuthStrategyResult,
  type AuthStrategyRegistry,
  type PassportModuleOptions,
} from './types';

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

@Inject([AUTH_STRATEGY_REGISTRY, PASSPORT_OPTIONS])
export class AuthGuard implements AuthGuardContract {
  constructor(
    private readonly strategies: AuthStrategyRegistry = {},
    private readonly options: PassportModuleOptions = {},
  ) {}

  async canActivate(context: GuardContext): Promise<void> {
    const requirement = getAuthRequirement(context.handler.controllerToken, context.handler.methodName);
    const strategyName = requirement?.strategy ?? this.options.defaultStrategy;

    if (!strategyName) {
      if (requirement?.scopes?.length) {
        throw new AuthStrategyResolutionError('Auth requirement exists without an active strategy.');
      }

      return;
    }

    const strategyToken = this.strategies[strategyName];

    if (!strategyToken) {
      throw new AuthStrategyResolutionError(`No auth strategy registered for ${strategyName}.`);
    }

    const strategy = await context.requestContext.container.resolve(strategyToken as Token<AuthStrategy>);

    try {
      const result = await strategy.authenticate(context);
      const principal = resolvePrincipal(result);

      if (isAuthHandledResult(result) && !principal) {
        return;
      }

      if (!principal) {
        throw new AuthenticationFailedError('Authentication strategy did not return a principal.');
      }

      if (requirement?.scopes?.length && !hasRequiredScopes(principal, requirement.scopes)) {
        throw new ForbiddenException('Access denied.');
      }

      context.requestContext.principal = principal;
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        throw new UnauthorizedException(error.message);
      }

      if (error instanceof AuthenticationExpiredError) {
        throw new UnauthorizedException(error.message);
      }

      if (error instanceof AuthenticationFailedError) {
        throw new UnauthorizedException(error.message);
      }

      throw error;
    }
  }
}
