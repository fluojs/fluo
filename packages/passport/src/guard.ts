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
import type {
  AuthGuardContract,
  AuthHandledResult,
  AuthStrategy,
  AuthStrategyResult,
  AuthStrategyRegistry,
  PassportModuleOptions,
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * HTTP guard that resolves the active auth strategy, authenticates the request,
 * and writes the resulting principal back to `requestContext.principal`.
 *
 * @remarks
 * `AuthGuard` preserves the public contract documented in `@konekti/passport`:
 * authentication failures become canonical `401 Unauthorized` responses, scope
 * mismatches become `403 Forbidden`, and strategies may short-circuit the
 * response by returning `{ handled: true }` after committing the response.
 */
@Inject([AUTH_STRATEGY_REGISTRY, PASSPORT_OPTIONS])
export class AuthGuard implements AuthGuardContract {
  constructor(
    private readonly strategies: AuthStrategyRegistry = {},
    private readonly options: PassportModuleOptions = {},
  ) {}

  /**
   * Executes the configured auth strategy for the current route and enforces any declared scopes.
   *
   * @example
   * ```ts
   * @Controller('/profile')
   * class ProfileController {
   *   @Get('/')
   *   @UseAuth('jwt')
   *   @RequireScopes('profile:read')
   *   getProfile() {}
   * }
   * ```
   *
   * @param context HTTP guard context for the active handler invocation.
   * @returns `true` when the request may continue through the HTTP pipeline.
   * @throws {AuthStrategyResolutionError} When no active strategy can be determined or resolved.
   * @throws {UnauthorizedException} When the strategy reports missing, expired, or invalid authentication.
   * @throws {ForbiddenException} When the authenticated principal is missing required scopes.
   */
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
        throw new AuthStrategyResolutionError(`Failed to resolve auth strategy "${strategyName}": ${toErrorMessage(error)}`);
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
