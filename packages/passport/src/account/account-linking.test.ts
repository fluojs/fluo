import { describe, expect, it } from 'vitest';

import {
  AccountLinkConflictError,
  AccountLinkRejectedError,
  createConservativeAccountLinkPolicy,
  resolveAccountLinking,
  type AccountLinkContext,
} from './account-linking.js';

function createContext(overrides: Partial<AccountLinkContext> = {}): AccountLinkContext {
  return {
    candidates: [],
    identity: {
      claims: {
        hd: 'example.com',
      },
      email: 'user@example.com',
      emailVerified: true,
      provider: 'google',
      providerSubject: 'google-user-1',
    },
    ...overrides,
  };
}

describe('resolveAccountLinking', () => {
  it('links a candidate after explicit user confirmation (happy path)', async () => {
    const policy = createConservativeAccountLinkPolicy();
    const result = await resolveAccountLinking(
      createContext({
        candidates: [
          {
            accountId: 'account-1',
            reason: 'email-match',
          },
        ],
        linkAttempt: {
          confirmedByUser: true,
          targetAccountId: 'account-1',
        },
      }),
      policy,
    );

    expect(result).toEqual({
      accountId: 'account-1',
      reason: 'Identity linked after explicit user confirmation.',
      status: 'linked',
    });
  });

  it('throws AccountLinkConflictError when multiple candidates match', async () => {
    const policy = createConservativeAccountLinkPolicy();

    await expect(
      resolveAccountLinking(
        createContext({
          candidates: [
            {
              accountId: 'account-1',
              reason: 'email-match',
            },
            {
              accountId: 'account-2',
              reason: 'username-match',
            },
          ],
        }),
        policy,
      ),
    ).rejects.toThrow(AccountLinkConflictError);

    try {
      await resolveAccountLinking(
        createContext({
          candidates: [
            {
              accountId: 'account-1',
              reason: 'email-match',
            },
            {
              accountId: 'account-2',
              reason: 'username-match',
            },
          ],
        }),
        policy,
      );
      expect.unreachable('Expected conflict error to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AccountLinkConflictError);
      expect((error as AccountLinkConflictError).candidateAccountIds).toEqual(['account-1', 'account-2']);
    }
  });

  it('returns skipped when no policy is configured (non-linking fallback)', async () => {
    const result = await resolveAccountLinking(
      createContext({
        candidates: [
          {
            accountId: 'account-1',
            reason: 'email-match',
          },
        ],
      }),
      undefined,
    );

    expect(result).toEqual({
      reason:
        'No account-linking policy was configured. The framework leaves identity linking to the application.',
      status: 'skipped',
    });
  });

  it('throws AccountLinkRejectedError when a link attempt is not confirmed', async () => {
    const policy = createConservativeAccountLinkPolicy();

    await expect(
      resolveAccountLinking(
        createContext({
          candidates: [
            {
              accountId: 'account-1',
              reason: 'email-match',
            },
          ],
          linkAttempt: {
            confirmedByUser: false,
            targetAccountId: 'account-1',
          },
        }),
        policy,
      ),
    ).rejects.toThrow(AccountLinkRejectedError);
  });
});
