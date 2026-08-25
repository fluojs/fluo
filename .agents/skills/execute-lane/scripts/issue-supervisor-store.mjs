import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  createIssueSupervisor,
  transitionIssueSupervisor,
} from './issue-supervisor.mjs';
import { assertIssueSupervisorState } from './issue-supervisor-contracts.mjs';
import {
  assertRealFile,
  atomicWrite,
  issueDirectory,
  withIssueLease,
} from './issue-supervisor-files.mjs';
import {
  assertSupervisorHistory,
  eventFor,
  persistedEventHash,
} from './issue-supervisor-history.mjs';
import { assertPersistedReceipt } from './issue-supervisor-receipts.mjs';

const filenames = {
  snapshot: 'snapshot.json',
  events: 'events.jsonl',
  receipts: 'receipts.json',
  transaction: 'transaction.json',
};

const assertBundle = (bundle) => {
  assertIssueSupervisorState(bundle.snapshot);
  assertSupervisorHistory(bundle.snapshot, bundle.events);
  if (!Array.isArray(bundle.receipts)) {
    throw new TypeError('issue supervisor receipts must be an array.');
  }
  bundle.receipts.forEach((receipt) =>
    assertPersistedReceipt(bundle.snapshot, receipt),
  );
};

export const assertIssueSupervisorBundle = assertBundle;

const applyTransaction = (directory, transaction) => {
  assertBundle(transaction);
  atomicWrite(
    resolve(directory, filenames.snapshot),
    `${JSON.stringify(transaction.snapshot, null, 2)}\n`,
  );
  atomicWrite(
    resolve(directory, filenames.events),
    `${transaction.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  atomicWrite(
    resolve(directory, filenames.receipts),
    `${JSON.stringify(transaction.receipts, null, 2)}\n`,
  );
  const path = resolve(directory, filenames.transaction);
  if (existsSync(path)) {
    unlinkSync(path);
  }
};

const recoverTransaction = (directory) => {
  const path = resolve(directory, filenames.transaction);
  assertRealFile(path);
  if (existsSync(path)) {
    applyTransaction(directory, JSON.parse(readFileSync(path, 'utf8')));
  }
};

const readBundle = (directory) => {
  recoverTransaction(directory);
  const snapshotPath = resolve(directory, filenames.snapshot);
  if (!existsSync(snapshotPath)) {
    return null;
  }
  for (const name of ['snapshot', 'events', 'receipts']) {
    assertRealFile(resolve(directory, filenames[name]));
  }
  const eventText = readFileSync(resolve(directory, filenames.events), 'utf8');
  const bundle = {
    snapshot: JSON.parse(readFileSync(snapshotPath, 'utf8')),
    events: eventText
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    receipts: JSON.parse(
      readFileSync(resolve(directory, filenames.receipts), 'utf8'),
    ),
  };
  assertBundle(bundle);
  return bundle;
};

const persistBundle = (directory, bundle, expectedPreviousHash) => {
  const transactionPath = resolve(directory, filenames.transaction);
  assertRealFile(transactionPath);
  if (existsSync(transactionPath)) {
    throw new TypeError('issue supervisor transaction already exists.');
  }
  if (
    persistedEventHash(directory, filenames.events) !== expectedPreviousHash
  ) {
    throw new TypeError('issue supervisor event CAS conflict.');
  }
  writeFileSync(
    transactionPath,
    `${JSON.stringify({ version: 1, ...bundle }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  applyTransaction(directory, bundle);
};

export const initialiseIssueSupervisorStore = (runtimeRoot, identity) => {
  const initial = createIssueSupervisor(identity);
  const directory = issueDirectory(
    runtimeRoot,
    initial.lane_id,
    initial.issue_number,
  );
  return withIssueLease(directory, () => {
    const existing = readBundle(directory);
    if (existing !== null) {
      for (const key of [
        'lane_id',
        'issue_number',
        'branch',
        'worktree',
        'starting_head_sha',
        'started_at',
        'authority_scope',
        'retry_policy',
        'lane_plan_approval_sha256',
        'release_handoff',
      ]) {
        if (
          JSON.stringify(existing.snapshot[key]) !==
          JSON.stringify(initial[key])
        ) {
          throw new TypeError(
            `issue supervisor store identity conflict: ${key}.`,
          );
        }
      }
      return existing;
    }
    const transition = { kind: 'initialised' };
    const bundle = {
      snapshot: initial,
      events: [eventFor([], transition, initial)],
      receipts: [],
    };
    persistBundle(directory, bundle, null);
    return bundle;
  });
};

export const applyIssueSupervisorTransition = (
  runtimeRoot,
  laneId,
  issueNumber,
  transition,
) => {
  const directory = issueDirectory(runtimeRoot, laneId, issueNumber);
  return withIssueLease(directory, () => {
    const current = readBundle(directory);
    if (current === null) {
      throw new TypeError('issue supervisor store must be initialised.');
    }
    const snapshot = transitionIssueSupervisor(current.snapshot, transition);
    const receipt =
      typeof transition.receipt === 'object' && transition.receipt !== null
        ? transition.receipt
        : null;
    const bundle = {
      snapshot,
      events: [
        ...current.events,
        eventFor(current.events, transition, snapshot),
      ],
      receipts:
        receipt === null ? current.receipts : [...current.receipts, receipt],
    };
    persistBundle(
      directory,
      bundle,
      current.events.at(-1)?.event_hash ?? null,
    );
    return bundle;
  });
};

export const loadIssueSupervisorStore = (
  runtimeRoot,
  laneId,
  issueNumber,
) => {
  const directory = issueDirectory(runtimeRoot, laneId, issueNumber);
  return withIssueLease(directory, () => readBundle(directory));
};
