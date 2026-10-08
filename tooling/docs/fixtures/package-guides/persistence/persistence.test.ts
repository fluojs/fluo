import { expect, it } from 'vitest';
import { AfterCommitError as CoreAfterCommitError } from '@fluojs/core';
import { AfterCommitError, type TransactionBoundaryOptions } from '@fluojs/persistence';
import { PrismaService } from '@fluojs/prisma';

it('composes a canonical boundary with the existing Prisma runner and error constructor', async () => {
  const events: string[] = [];
  const root = {
    async $transaction<T>(callback: (client: object) => Promise<T>): Promise<T> {
      const result = await callback({});
      events.push('commit');
      return result;
    },
  };
  const service = new PrismaService(root);
  const boundary: TransactionBoundaryOptions<{ readonly ok: boolean }> = { requireAfterCommit: true };
  const value = { ok: true };

  const result = await service.transaction(async () => {
    service.afterCommit(() => { events.push('hook'); });
    return value;
  }, undefined, boundary);

  expect(result).toBe(value);
  expect(events).toEqual(['commit', 'hook']);
  expect(CoreAfterCommitError).toBe(AfterCommitError);
});
