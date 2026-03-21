import type { Token } from '@konekti/core';
import type { GuardContext, Principal } from '@konekti/http';
import type { Provider } from '@konekti/di';

import { AuthenticationFailedError, AuthenticationRequiredError } from './errors.js';
import { normalizePrincipalScopes } from './scope.js';
import type { AuthHandledResult, AuthStrategy, AuthStrategyRegistration } from './types.js';

interface PassportJsActionBindings {
  error?: (error: unknown) => void;
  fail?: (challenge?: unknown, status?: number) => void;
  pass?: () => void;
  redirect?: (url: string, status?: number) => void;
  success?: (user: unknown, info?: unknown) => void;
}

export interface PassportJsStrategyLike {
  authenticate(request: unknown, options?: unknown): unknown;
}

type PassportJsExecutableStrategy = PassportJsStrategyLike & PassportJsActionBindings;

export interface PassportJsPrincipalMapperInput {
  context: GuardContext;
  info?: unknown;
  user: unknown;
}

export type PassportJsPrincipalMapper = (input: PassportJsPrincipalMapperInput) => Principal;

export interface PassportJsAuthStrategyOptions {
  authenticateOptions?: Readonly<Record<string, unknown>>;
  mapPrincipal?: PassportJsPrincipalMapper;
}

export interface PassportJsStrategyBridge {
  providers: Provider[];
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

export class PassportJsAuthStrategy implements AuthStrategy {
  constructor(
    private readonly strategyTemplate: PassportJsStrategyLike,
    private readonly options: PassportJsAuthStrategyOptions = {},
  ) {}

  authenticate(context: GuardContext): Promise<Principal | AuthHandledResult> {
    const response = context.requestContext.response;
    const request = context.requestContext.request.raw ?? context.requestContext.request;
    const strategy = Object.create(this.strategyTemplate) as PassportJsExecutableStrategy;
    const mapPrincipal = this.options.mapPrincipal ?? defaultPrincipalMapper;

    return new Promise((resolve, reject) => {
      const settle = this.createSettleGuard();

      this.bindStrategyActions(strategy, {
        context,
        mapPrincipal,
        reject,
        resolve,
        response,
        settle,
      });

      try {
        strategy.authenticate(request, this.options.authenticateOptions);
      } catch (error: unknown) {
        settle(() => reject(error));
      }
    });
  }

  private createSettleGuard(): (handler: () => void) => void {
    let settled = false;

    return (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      handler();
    };
  }

  private bindStrategyActions(
    strategy: PassportJsExecutableStrategy,
    state: {
      context: GuardContext;
      mapPrincipal: PassportJsPrincipalMapper;
      reject: (reason?: unknown) => void;
      resolve: (value: Principal | AuthHandledResult) => void;
      response: GuardContext['requestContext']['response'];
      settle: (handler: () => void) => void;
    },
  ): void {
    strategy.success = (user, info) => {
      state.settle(() => {
        try {
          state.resolve(state.mapPrincipal({ context: state.context, info, user }));
        } catch (error: unknown) {
          state.reject(error);
        }
      });
    };

    strategy.fail = (challenge, status) => {
      state.settle(() => {
        state.reject(this.createFailureError(challenge, status));
      });
    };

    strategy.redirect = (url, status = 302) => {
      state.settle(() => {
        state.response.redirect(status, url);
        state.resolve({ handled: true });
      });
    };

    strategy.pass = () => {
      state.settle(() => {
        state.reject(new AuthenticationRequiredError());
      });
    };

    strategy.error = (error) => {
      state.settle(() => {
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

export function createPassportJsStrategyBridge(
  name: string,
  strategyToken: Token<PassportJsStrategyLike>,
  options: PassportJsAuthStrategyOptions = {},
): PassportJsStrategyBridge {
  const adapterToken = Symbol.for(`konekti.passport.passport-js.adapter.${name}`);
  const optionsToken = Symbol.for(`konekti.passport.passport-js.options.${name}`);

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
