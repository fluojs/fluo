import {
  createConservativeAccountLinkPolicy,
  resolveAccountLinking,
  type AuthStrategy,
  type Principal,
} from '@fluojs/auth';
import { describe, expect, it } from 'vitest';

describe('neutral authentication guide composition', () => {
  it('authenticates application input without an HTTP context', () => {
    class ServiceStrategy implements AuthStrategy<{ identity: string }> {
      authenticate(input: { identity: string }): Principal {
        return { subject: input.identity, claims: {} };
      }
    }
    const strategy = new ServiceStrategy();

    const principal = strategy.authenticate({ identity: 'guide-user' });

    expect(principal).toEqual({ subject: 'guide-user', claims: {} });
  });

  it('resolves deduplicated existing identity links through the neutral policy', async () => {
    const policy = createConservativeAccountLinkPolicy();
    const context = {
      identity: { provider: 'guide', providerSubject: 'external-user' },
      candidates: [
        { accountId: 'account-1', reason: 'existing-link' },
        { accountId: 'account-1', reason: 'existing-link' },
      ],
    };

    const result = await resolveAccountLinking(context, policy);

    expect(result).toMatchObject({ status: 'linked', accountId: 'account-1' });
  });
});
