import { describe, expect, it } from 'vitest';

import { closeGraphqlTestApplications } from './network.test-fixture.js';

describe('GraphQL network test fixture cleanup', () => {
  it('closes every owner and retains only failed owners for a deterministic retry', async () => {
    const failingOwner = {
      async close(): Promise<void> {
        throw new Error('close failed');
      },
    };
    let successfulCloseCount = 0;
    const successfulOwner = {
      async close(): Promise<void> {
        successfulCloseCount += 1;
      },
    };
    const owners = new Map<number, typeof failingOwner | typeof successfulOwner>([
      [1, failingOwner],
      [2, successfulOwner],
    ]);

    await expect(closeGraphqlTestApplications(owners)).rejects.toThrow(AggregateError);

    expect(successfulCloseCount).toBe(1);
    expect(owners.get(1)).toBe(failingOwner);
    expect(owners.has(2)).toBe(false);
  });
});
