import { KonektiError, type MaybePromise } from '@konekti/core';

/** DI token for registering an account-linking policy implementation. */
export const ACCOUNT_LINKING_POLICY = Symbol.for('konekti.passport.account-linking-policy');

/** Identity payload from an external authentication provider. */
export interface AccountIdentity {
  provider: string;
  providerSubject: string;
  email?: string;
  emailVerified?: boolean;
  claims?: Record<string, unknown>;
}

/** Candidate account that may be linked to an external identity. */
export interface AccountLinkCandidate {
  accountId: string;
  reason: 'existing-link' | 'email-match' | 'username-match' | string;
}

/** Explicit user confirmation payload for a requested linking target. */
export interface AccountLinkAttempt {
  targetAccountId: string;
  confirmedByUser: boolean;
}

/** Input passed to account-link policy evaluation. */
export interface AccountLinkContext {
  identity: AccountIdentity;
  candidates: AccountLinkCandidate[];
  linkAttempt?: AccountLinkAttempt;
}

/** Normalized decision contract returned by an `AccountLinkPolicy`. */
export type AccountLinkPolicyDecision =
  | {
      action: 'link';
      accountId: string;
      reason: string;
    }
  | {
      action: 'create-account';
      reason: string;
    }
  | {
      action: 'reject';
      reason: string;
      code?: string;
    }
  | {
      action: 'conflict';
      reason: string;
      candidateAccountIds: string[];
    };

/** Policy contract for account-linking decisions. */
export interface AccountLinkPolicy {
  evaluate(context: AccountLinkContext): MaybePromise<AccountLinkPolicyDecision>;
}

/** Optional runtime behavior when no policy is configured. */
export interface AccountLinkingOptions {
  fallback?: 'create-account' | 'skip';
}

/** Final framework-level resolution for account-linking flow. */
export type AccountLinkingResolution =
  | {
      status: 'linked';
      accountId: string;
      reason: string;
    }
  | {
      status: 'create-account';
      reason: string;
    }
  | {
      status: 'skipped';
      reason: string;
    };

/** Error raised when linking requires user confirmation among candidates. */
export class AccountLinkConflictError extends KonektiError {
  readonly candidateAccountIds: string[];

  constructor(
    candidateAccountIds: string[],
    message = 'Multiple account candidates require explicit link confirmation.',
  ) {
    super(message, {
      code: 'ACCOUNT_LINK_CONFLICT',
      meta: {
        candidateAccountIds: [...candidateAccountIds],
      },
    });

    this.candidateAccountIds = [...candidateAccountIds];
  }
}

/** Error raised when an account-linking attempt is rejected by policy. */
export class AccountLinkRejectedError extends KonektiError {
  constructor(message = 'Account-linking attempt was rejected.', code = 'ACCOUNT_LINK_REJECTED') {
    super(message, { code });
  }
}

/**
 * Conservative baseline policy that never auto-links ambiguous candidates.
 *
 * @returns An `AccountLinkPolicy` implementation that requires explicit user confirmation for non-explicit matches.
 */
export function createConservativeAccountLinkPolicy(): AccountLinkPolicy {
  return {
    evaluate(context) {
      const existingLink = context.candidates.find((candidate) => candidate.reason === 'existing-link');
      if (existingLink) {
        return {
          action: 'link',
          accountId: existingLink.accountId,
          reason: 'Existing identity link found.',
        };
      }

      const linkAttempt = context.linkAttempt;
      if (linkAttempt) {
        if (!linkAttempt.confirmedByUser) {
          return {
            action: 'reject',
            code: 'ACCOUNT_LINK_CONFIRMATION_REQUIRED',
            reason: 'Explicit link confirmation is required before linking identities.',
          };
        }

        if (context.candidates.some((candidate) => candidate.accountId === linkAttempt.targetAccountId)) {
          return {
            action: 'link',
            accountId: linkAttempt.targetAccountId,
            reason: 'Identity linked after explicit user confirmation.',
          };
        }

        return {
          action: 'reject',
          code: 'ACCOUNT_LINK_TARGET_NOT_FOUND',
          reason: 'Requested account for linking is not a valid candidate.',
        };
      }

      if (context.candidates.length === 0) {
        return {
          action: 'create-account',
          reason: 'No matching account candidate found for this external identity.',
        };
      }

      return {
        action: 'conflict',
        candidateAccountIds: context.candidates.map((candidate) => candidate.accountId),
        reason:
          context.candidates.length === 1
            ? 'A single account candidate matched. Explicit confirmation is required before linking.'
            : 'Multiple account candidates matched. Explicit confirmation is required before linking.',
      };
    },
  };
}

const DEFAULT_SKIP_REASON =
  'No account-linking policy was configured. The framework leaves identity linking to the application.';

/**
 * Resolves account-linking flow using the provided policy and fallback rules.
 *
 * @param context Identity, candidate accounts, and optional explicit link-attempt confirmation input.
 * @param policy Optional account-link policy implementation. When omitted, `options.fallback` controls behavior.
 * @param options Runtime fallback behavior used only when `policy` is not configured.
 * @returns A normalized framework decision: `linked`, `create-account`, or `skipped`.
 * @throws {AccountLinkRejectedError} When policy returns `action: 'reject'`.
 * @throws {AccountLinkConflictError} When policy returns `action: 'conflict'` and explicit confirmation is required.
 */
export async function resolveAccountLinking(
  context: AccountLinkContext,
  policy?: AccountLinkPolicy,
  options: AccountLinkingOptions = {},
): Promise<AccountLinkingResolution> {
  if (!policy) {
    if (options.fallback === 'create-account') {
      return {
        reason: 'No policy configured. Falling back to account creation.',
        status: 'create-account',
      };
    }

    return {
      reason: DEFAULT_SKIP_REASON,
      status: 'skipped',
    };
  }

  const decision = await policy.evaluate(context);

  switch (decision.action) {
    case 'link':
      return {
        accountId: decision.accountId,
        reason: decision.reason,
        status: 'linked',
      };

    case 'create-account':
      return {
        reason: decision.reason,
        status: 'create-account',
      };

    case 'reject':
      throw new AccountLinkRejectedError(decision.reason, decision.code);

    case 'conflict':
      throw new AccountLinkConflictError(decision.candidateAccountIds, decision.reason);

    default: {
      const exhaustiveCheck: never = decision;
      return exhaustiveCheck;
    }
  }
}
