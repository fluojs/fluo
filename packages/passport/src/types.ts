import type { MaybePromise, Token } from '@fluojs/core';
import type { Guard, GuardContext, Principal } from '@fluojs/http';

/** Route-level authentication requirement metadata. */
export interface AuthRequirement {
  /** Named strategy to resolve from the strategy registry. */
  strategy?: string;
  /** Allows the request to continue without a resolved principal. */
  optional?: boolean;
  /** Required scopes that must be present on the resolved principal. */
  scopes?: string[];
}

/** Authentication result variant used when a route explicitly allows missing credentials. */
export interface AuthOptionalResult {
  authenticated: false;
}

/** Authentication result variant used when a strategy fully handled the response. */
export interface AuthHandledResult {
  handled: true;
  principal?: Principal;
}

/** Return type of an `AuthStrategy.authenticate(...)` call. */
export type AuthStrategyResult = Principal | AuthHandledResult | AuthOptionalResult;

/** Strategy contract implemented by authentication adapters. */
export interface AuthStrategy {
  authenticate(context: GuardContext): MaybePromise<AuthStrategyResult>;
}

/** Registration entry used by `PassportModule.forRoot(...)`. */
export interface AuthStrategyRegistration {
  name: string;
  token: Token<AuthStrategy>;
}

/** Immutable strategy lookup map keyed by strategy name. */
export type AuthStrategyRegistry = Readonly<Record<string, Token<AuthStrategy>>>;

/** Module-level options for passport strategy wiring. */
export interface PassportModuleOptions {
  defaultStrategy?: string;
}

/** Contract for the public `AuthGuard` behavior. */
export interface AuthGuardContract extends Guard {
  canActivate(context: GuardContext): Promise<true>;
}
