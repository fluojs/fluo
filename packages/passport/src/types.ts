import type { MaybePromise, Token } from '@konekti/core';
import type { Guard, GuardContext, Principal } from '@konekti/http';

export const AUTH_STRATEGY_REGISTRY = Symbol.for('konekti.passport.strategy-registry');
export const PASSPORT_OPTIONS = Symbol.for('konekti.passport.options');

export interface AuthRequirement {
  strategy?: string;
  scopes?: string[];
}

export interface AuthHandledResult {
  handled: true;
  principal?: Principal;
}

export type AuthStrategyResult = Principal | AuthHandledResult;

export interface AuthStrategy {
  authenticate(context: GuardContext): MaybePromise<AuthStrategyResult>;
}

export interface AuthStrategyRegistration {
  name: string;
  token: Token<AuthStrategy>;
}

export type AuthStrategyRegistry = Readonly<Record<string, Token<AuthStrategy>>>;

export interface PassportModuleOptions {
  defaultStrategy?: string;
}

export interface AuthGuardContract extends Guard {
  canActivate(context: GuardContext): Promise<true>;
}
