import { describe, expect, it } from 'vitest';

import { Transaction } from './transaction.js';

describe('Transaction decorator target precedence', () => {
  it('selects every direct target before nested .db targets regardless of property creation order', async () => {
    const events: string[] = [];
    const nestedDatabase = {
      async transaction<T>(callback: () => Promise<T>): Promise<T> {
        events.push('nested:transaction:start');
        const result = await callback();
        events.push('nested:transaction:end');
        return result;
      },
    };
    const directDatabase = {
      async transaction<T>(callback: () => Promise<T>): Promise<T> {
        events.push('direct:transaction:start');
        const result = await callback();
        events.push('direct:transaction:end');
        return result;
      },
    };

    class DirectAfterNestedService {
      readonly repository = { db: nestedDatabase };
      readonly directDb = directDatabase;

      @Transaction()
      async run() {
        events.push('work');
      }
    }

    // Given: a nested target constructed before a direct Drizzle target.
    const service = new DirectAfterNestedService();

    // When: the default transaction decorator resolves its host target.
    await service.run();

    // Then: the later direct target still wins over every nested .db target.
    expect(events).toEqual([
      'direct:transaction:start',
      'work',
      'direct:transaction:end',
    ]);
  });
});
