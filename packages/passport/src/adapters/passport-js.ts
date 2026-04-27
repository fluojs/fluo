import type { Token } from '@fluojs/core';
import type { GuardContext, Principal } from '@fluojs/http';
import type { Provider } from '@fluojs/di';

import { AuthenticationFailedError, AuthenticationRequiredError } from '../errors.js';
import { normalizePrincipalScopes } from '../scope.js';
import type { AuthHandledResult, AuthStrategy, AuthStrategyRegistration } from '../types.js';

interface PassportJsActionBindings {
  error?: (error: unknown) => void;
  fail?: (challenge?: unknown, status?: number) => void;
  pass?: () => void;
  redirect?: (url: string, status?: number) => void;
  success?: (user: unknown, info?: unknown) => void;
}

/**
 * Represents a Passport.js strategy-like object that implements
 * the `authenticate` method.
 */
export interface PassportJsStrategyLike {
  /**
   * Performs authentication for the given request and options.
   *
   * @param request - The raw request object from the underlying framework.
   * @param options - Strategy-specific authentication options.
   * @returns An execution result or a promise resolving to one.
   */
  authenticate(request: unknown, options?: unknown): unknown;
}

type PassportJsExecutableStrategy = PassportJsStrategyLike & PassportJsActionBindings;

interface PassportJsRequestState {
  context: GuardContext;
  mapPrincipal: PassportJsPrincipalMapper;
  reject: (reason?: unknown) => void;
  resolve: (value: Principal | AuthHandledResult) => void;
  response: GuardContext['requestContext']['response'];
  settled: boolean;
}

/**
 * Input for the principal mapper that converts Passport.js user data
 * into a fluo {@link Principal}.
 */
export interface PassportJsPrincipalMapperInput {
  /** The guard context for the current request. */
  context: GuardContext;
  /** Optional information returned by the Passport strategy. */
  info?: unknown;
  /** The user object returned by the Passport strategy. */
  user: unknown;
}

/**
 * A function type that maps Passport.js user data to a fluo {@link Principal}.
 */
export type PassportJsPrincipalMapper = (input: PassportJsPrincipalMapperInput) => Principal;

/**
 * Configuration options for the Passport.js authentication strategy.
 */
export interface PassportJsAuthStrategyOptions {
  /** Optional options to pass to the Passport strategy's `authenticate` method. */
  authenticateOptions?: Readonly<Record<string, unknown>>;
  /** Optional custom mapper for converting user data to a principal. */
  mapPrincipal?: PassportJsPrincipalMapper;
}

/**
 * Bridge interface containing DI providers and strategy registration for Passport.js.
 */
export interface PassportJsStrategyBridge {
  /** DI providers required for the adapter and its configuration. */
  providers: Provider[];
  /** Canonical strategy registration for the fluo auth guard. */
  strategy: AuthStrategyRegistration;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}

function extractSubject(user: Record<string, unknown>): string | undefined {
  if (typeof user.sub === 'string' && user.sub.length > 0) {
    return user.sub;
  }

  if (typeof user.id === 'string' && user.id.length > 0) {
    return user.id;
  }

  if (typeof user.id === 'number') {
    return String(user.id);
  }

  if (typeof user.userId === 'string' && user.userId.length > 0) {
    return user.userId;
  }

  return undefined;
}

function defaultPrincipalMapper(input: PassportJsPrincipalMapperInput): Principal {
  if (typeof input.user !== 'object' || input.user === null) {
    throw new AuthenticationFailedError('Passport strategy returned an invalid user payload.');
  }

  const claims = { ...(input.user as Record<string, unknown>) };
  const subject = extractSubject(claims);

  if (!subject) {
    throw new AuthenticationFailedError('Passport strategy returned a user payload without a subject or id.');
  }

  const issuer = typeof claims.iss === 'string' ? claims.iss : undefined;
  const audience =
    typeof claims.aud === 'string' || Array.isArray(claims.aud)
      ? (claims.aud as string | string[])
      : undefined;

  return {
    audience,
    claims,
    issuer,
    roles: toStringArray(claims.roles),
    scopes: normalizePrincipalScopes(claims),
    subject,
  };
}

function extractChallengeMessage(challenge: unknown): string | undefined {
  if (typeof challenge === 'string' && challenge.length > 0) {
    return challenge;
  }

  if (typeof challenge === 'object' && challenge !== null) {
    const message = (challenge as Record<string, unknown>).message;

    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return undefined;
}

function cloneStrategyStateValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice();
  }

  if (value && typeof value === 'object') {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }

  return value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * A bridge strategy that allows using Passport.js strategies within the fluo
 * authentication framework.
 */
export class PassportJsAuthStrategy implements AuthStrategy {
  private readonly requestState = new WeakMap<PassportJsExecutableStrategy, PassportJsRequestState>();

  constructor(
    private readonly strategyTemplate: PassportJsStrategyLike,
    private readonly options: PassportJsAuthStrategyOptions = {},
  ) {}

  authenticate(context: GuardContext): Promise<Principal | AuthHandledResult> {
    const response = context.requestContext.response;
    const request = context.requestContext.request.raw ?? context.requestContext.request;
    const strategy = this.createExecutableStrategy();
    const mapPrincipal = this.options.mapPrincipal ?? defaultPrincipalMapper;

    return new Promise((resolve, reject) => {
      this.requestState.set(strategy, {
        context,
        mapPrincipal,
        reject,
        resolve,
        response,
        settled: false,
      });

      this.bindStrategyActions(strategy);

      try {
        const result = strategy.authenticate(request, this.options.authenticateOptions);

        if (isPromiseLike(result)) {
          result.then(
            () => {
              this.settle(strategy, (state) => {
                state.reject(new AuthenticationRequiredError('Passport strategy did not settle authentication.'));
              });
            },
            (error: unknown) => {
              this.settle(strategy, (state) => {
                state.reject(error);
              });
            },
          );
        }
      } catch (error: unknown) {
        this.settle(strategy, () => reject(error));
      }
    });
  }

  private createExecutableStrategy(): PassportJsExecutableStrategy {
    const template = this.strategyTemplate;
    const strategy = Object.create(Object.getPrototypeOf(this.strategyTemplate)) as PassportJsExecutableStrategy &
      Record<PropertyKey, unknown>;

    for (const key of Reflect.ownKeys(template)) {
      const value = Reflect.get(template, key);

      if (typeof value === 'function') {
        strategy[key] = value.bind(strategy);
        continue;
      }

      strategy[key] = cloneStrategyStateValue(value);
    }

    return strategy;
  }

  private settle(strategy: PassportJsExecutableStrategy, handler: (state: PassportJsRequestState) => void): void {
    const state = this.requestState.get(strategy);

    if (!state || state.settled) {
      return;
    }

    state.settled = true;

    try {
      handler(state);
    } finally {
      this.requestState.delete(strategy);
    }
  }

  private bindStrategyActions(strategy: PassportJsExecutableStrategy): void {
    strategy.success = (user, info) => {
      this.settle(strategy, (state) => {
        try {
          state.resolve(state.mapPrincipal({ context: state.context, info, user }));
        } catch (error: unknown) {
          state.reject(error);
        }
      });
    };

    strategy.fail = (challenge, status) => {
      this.settle(strategy, (state) => {
        state.reject(this.createFailureError(challenge, status));
      });
    };

    strategy.redirect = (url, status = 302) => {
      this.settle(strategy, (state) => {
        state.response.redirect(status, url);
        state.resolve({ handled: true });
      });
    };

    strategy.pass = () => {
      this.settle(strategy, (state) => {
        state.reject(new AuthenticationRequiredError());
      });
    };

    strategy.error = (error) => {
      this.settle(strategy, (state) => {
        state.reject(error);
      });
    };
  }

  private createFailureError(challenge: unknown, status: number | undefined): Error {
    const message = extractChallengeMessage(challenge) ?? 'Authentication required.';

    if (status === 401 || status === undefined) {
      return new AuthenticationRequiredError(message);
    }

    return new AuthenticationFailedError(message);
  }
}

/**
 * Creates a DI-aware bridge for a Passport.js strategy.
 *
 * @param name Unique name for the strategy.
 * @param strategyToken Token representing the Passport.js strategy implementation.
 * @param options Configuration for principal mapping and authentication options.
 * @returns A bridge object containing providers and the strategy registration.
 */
export function createPassportJsStrategyBridge(
  name: string,
  strategyToken: Token<PassportJsStrategyLike>,
  options: PassportJsAuthStrategyOptions = {},
): PassportJsStrategyBridge {
  const adapterToken = Symbol.for(`fluo.passport.passport-js.adapter.${name}`);
  const optionsToken = Symbol.for(`fluo.passport.passport-js.options.${name}`);

  return {
    providers: [
      {
        provide: optionsToken,
        useValue: { ...options },
      },
      {
        provide: adapterToken,
        inject: [strategyToken, optionsToken],
        useFactory: (...deps: unknown[]) => {
          const [strategy, resolvedOptions] = deps as [PassportJsStrategyLike, PassportJsAuthStrategyOptions];
          return new PassportJsAuthStrategy(strategy, resolvedOptions);
        },
      },
    ],
    strategy: {
      name,
      token: adapterToken,
    },
  };
}
