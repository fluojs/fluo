import type { Token } from '@fluojs/core';
import type { Guard, GuardContext } from '@fluojs/http';

/** Route-level authentication requirement metadata. */
export interface AuthRequirement {
  /** Named strategy to resolve from the strategy registry. */
  strategy?: string;
  /** Allows the request to continue without a resolved principal. */
  optional?: boolean;
  /** Required scopes that must be present on the resolved principal. */
  scopes?: string[];
}

/** HTTP specialization of the neutral authentication contract. */
export type AuthStrategy = import('@fluojs/auth').AuthStrategy<GuardContext>;
export type { AuthOptionalResult, AuthHandledResult, AuthStrategyResult } from '@fluojs/auth';

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
  /** Whether passport guard providers should be visible globally. Defaults to `false`. */
  global?: boolean;
}

/** Contract for the public `AuthGuard` behavior. */
export interface AuthGuardContract extends Guard {
  canActivate(context: GuardContext): Promise<true>;
}

/** Canonical HTTP authentication module options; identical to the legacy options shape. */
export type AuthModuleOptions = PassportModuleOptions;
