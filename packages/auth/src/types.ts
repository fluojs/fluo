import type { MaybePromise } from '@fluojs/core';

/** Transport-neutral authenticated identity; fields retain their mutable compatibility shape. */
export interface Principal {
  subject: string;
  issuer?: string;
  audience?: string | string[];
  roles?: string[];
  scopes?: string[];
  claims: Record<string, unknown>;
}

/** Explicit unauthenticated result; the transport decides whether it is permitted. */
export interface AuthOptionalResult {
  authenticated: false;
}

/** A strategy-owned terminal result; the transport must confirm response commitment. */
export interface AuthHandledResult {
  handled: true;
  principal?: Principal;
}

/** Identity, explicit absence, or strategy-owned completion returned by authentication. */
export type AuthStrategyResult = Principal | AuthHandledResult | AuthOptionalResult;

/** Authentication contract parameterized by the caller's input, without a transport dependency. */
export interface AuthStrategy<Context = unknown> {
  /**
   * Authenticates the supplied input without imposing a transport or inheritance model.
   * @param context Application or adapter input for this authentication attempt.
   * @returns An identity, explicit absence, or strategy-owned completion result.
   */
  authenticate(context: Context): MaybePromise<AuthStrategyResult>;
}
