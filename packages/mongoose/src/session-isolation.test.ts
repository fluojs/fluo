import { describe, expect, it } from 'vitest';

import { MongooseConnection } from './index.js';
import type { MongooseModelFacade, MongooseSessionLike } from './types.js';

type Branch = 'first' | 'second';

function createFakeSession(branch: Branch, events: string[]): MongooseSessionLike {
  return {
    abortTransaction() {
      events.push(`${branch}:transaction:abort`);
    },
    commitTransaction() {
      events.push(`${branch}:transaction:commit`);
    },
    endSession() {
      events.push(`${branch}:session:end`);
    },
    startTransaction() {
      events.push(`${branch}:transaction:start`);
    },
  };
}

describe('MongooseConnection session isolation', () => {
  it('keeps overlapping async branches bound to their own ambient and facade sessions', async () => {
    // Given
    const events: string[] = [];
    const firstSession = createFakeSession('first', events);
    const secondSession = createFakeSession('second', events);
    const sessions = [firstSession, secondSession] as const;
    const operationSessions: Array<{
      readonly branch: Branch;
      readonly session: MongooseSessionLike | undefined;
    }> = [];
    const UserModel = {
      async create(
        docs: readonly [{ readonly branch: Branch }],
        options?: { readonly session?: MongooseSessionLike },
      ): Promise<readonly []> {
        operationSessions.push({ branch: docs[0].branch, session: options?.session });

        return [];
      },
    };
    let sessionIndex = 0;
    const connection = {
      model() {
        return UserModel;
      },
      async startSession(): Promise<MongooseSessionLike> {
        const session = sessions[sessionIndex];
        sessionIndex += 1;

        if (session === undefined) {
          throw new RangeError('The test connection only provides two sessions.');
        }

        return session;
      },
    };
    const mongoose = new MongooseConnection(connection);
    let enteredBranches = 0;
    let releaseOverlap: () => void = () => undefined;
    const branchesOverlapping = new Promise<void>((resolve) => {
      releaseOverlap = resolve;
    });
    const runBranch = (branch: Branch) =>
      mongoose.transaction(async () => {
        const ambientBeforeOverlap = mongoose.currentSession();
        enteredBranches += 1;

        if (enteredBranches === sessions.length) {
          releaseOverlap();
        }

        await branchesOverlapping;

        const ambientAfterOverlap = mongoose.currentSession();
        await mongoose.model<MongooseModelFacade<Promise<readonly []>>>('User').create([{ branch }]);

        return { ambientAfterOverlap, ambientBeforeOverlap };
      });

    // When
    const [firstResult, secondResult] = await Promise.all([
      runBranch('first'),
      runBranch('second'),
    ]);

    // Then
    expect(firstResult).toEqual({
      ambientAfterOverlap: firstSession,
      ambientBeforeOverlap: firstSession,
    });
    expect(secondResult).toEqual({
      ambientAfterOverlap: secondSession,
      ambientBeforeOverlap: secondSession,
    });
    expect(operationSessions).toHaveLength(2);
    expect(operationSessions).toEqual(expect.arrayContaining([
      { branch: 'first', session: firstSession },
      { branch: 'second', session: secondSession },
    ]));
    expect(mongoose.currentSession()).toBeUndefined();
    expect(events).toHaveLength(6);
    expect(events).toEqual(expect.arrayContaining([
      'first:transaction:start',
      'first:transaction:commit',
      'first:session:end',
      'second:transaction:start',
      'second:transaction:commit',
      'second:session:end',
    ]));
  });
});
