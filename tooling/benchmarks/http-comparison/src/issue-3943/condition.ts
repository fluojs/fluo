import type { EvidenceJournal } from '../evidence';

export async function retainCondition<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
  journal: EvidenceJournal,
): Promise<T> {
  const [result] = await Promise.allSettled([Promise.resolve().then(operation)]);
  const failures: unknown[] = [];
  if (result.status === 'rejected') {
    failures.push(result.reason);
    journal.fail(result.reason);
  }
  const [teardown] = await Promise.allSettled([Promise.resolve().then(cleanup)]);
  if (teardown.status === 'rejected') {
    failures.push(teardown.reason);
    journal.fail(teardown.reason);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Condition failed; original and cleanup errors retained');
  }
  switch (result.status) {
    case 'fulfilled': return result.value;
    case 'rejected': throw result.reason;
  }
}
