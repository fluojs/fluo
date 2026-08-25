import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  assertContract,
  assertEventChain,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import { assertReleaseHandoffApproval } from './release-handoff-approval.mjs';

const assertRegularFile = (path) => {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

const readJson = (path) => {
  assertRegularFile(path);
  return JSON.parse(readFileSync(path, 'utf8'));
};

const ensureStateDirectory = (path) => {
  if (!existsSync(path)) {
    mkdirSync(path);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError('state directory must be a real directory.');
  }
};

const writeAtomic = (path, value) => {
  assertRegularFile(path);
  const candidate = `${path}.${randomUUID()}.tmp`;
  writeFileSync(candidate, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    renameSync(candidate, path);
  } finally {
    if (existsSync(candidate)) {
      unlinkSync(candidate);
    }
  }
};

const readEvents = (path) => {
  if (!existsSync(path)) {
    return [];
  }
  assertRegularFile(path);
  const content = readFileSync(path, 'utf8').trim();
  return content === ''
    ? []
    : content.split('\n').map((line) => JSON.parse(line));
};

const validateState = ({ snapshot, events, receipts }) => {
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  if (events.length > 0) {
    assertEventChain(events);
  }
  if (!Array.isArray(receipts)) {
    throw new TypeError('receipts.json must contain an array.');
  }
  for (const receipt of receipts) {
    assertContract('receipt', receipt);
  }
};

const assertEventPrefix = (prefix, events) => {
  const matches =
    prefix.length <= events.length &&
    prefix.every(
      (event, index) => event.event_hash === events[index]?.event_hash,
    );
  if (!matches) {
    throw new TypeError('persisted event history must remain an exact prefix.');
  }
};

const applyTransaction = (stateDirectory, transaction) => {
  if (
    transaction?.version !== 1 ||
    !Array.isArray(transaction.events) ||
    !Array.isArray(transaction.receipts)
  ) {
    throw new TypeError('transaction.json has an invalid shape.');
  }
  validateState(transaction);
  const eventsPath = resolve(stateDirectory, 'events.jsonl');
  const existingEvents = readEvents(eventsPath);
  assertEventPrefix(existingEvents, transaction.events);
  const missingEvents = transaction.events.slice(existingEvents.length);
  if (missingEvents.length > 0) {
    appendFileSync(
      eventsPath,
      `${missingEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    );
  }
  writeAtomic(resolve(stateDirectory, 'snapshot.json'), transaction.snapshot);
  writeAtomic(resolve(stateDirectory, 'receipts.json'), transaction.receipts);
};

const recoverTransaction = (stateDirectory) => {
  const path = resolve(stateDirectory, 'transaction.json');
  if (!existsSync(path)) {
    return;
  }
  applyTransaction(stateDirectory, readJson(path));
  unlinkSync(path);
};

export const loadState = (
  stateDirectory,
  ledgerPath,
  approvalReceiptPath = null,
) => {
  ensureStateDirectory(stateDirectory);
  recoverTransaction(stateDirectory);
  const snapshotPath = resolve(stateDirectory, 'snapshot.json');
  const snapshot = existsSync(snapshotPath)
    ? readJson(snapshotPath)
    : readJson(ledgerPath);
  const events = readEvents(resolve(stateDirectory, 'events.jsonl'));
  const receiptsPath = resolve(stateDirectory, 'receipts.json');
  const receipts = existsSync(receiptsPath) ? readJson(receiptsPath) : [];
  const state = { snapshot, events, receipts };
  validateState(state);
  const releaseHandoffApproval =
    approvalReceiptPath === null ? null : readJson(approvalReceiptPath);
  assertReleaseHandoffApproval(snapshot, releaseHandoffApproval);
  return { ...state, releaseHandoffApproval };
};

export const acquireLease = (stateDirectory, laneId) => {
  const lockPath = resolve(stateDirectory, 'lease.lock');
  const descriptor = openSync(lockPath, 'wx');
  const token = randomUUID();
  const leasePath = resolve(stateDirectory, 'lease.json');
  writeAtomic(leasePath, {
    version: 1,
    lane_id: laneId,
    holder: `execute-lane:${token}`,
    status: 'active',
  });
  return {
    release(outcome) {
      closeSync(descriptor);
      unlinkSync(lockPath);
      writeAtomic(leasePath, {
        version: 1,
        lane_id: laneId,
        holder: `execute-lane:${token}`,
        status: 'released',
        outcome,
      });
    },
  };
};

export const persistState = (stateDirectory, previous, next) => {
  validateState(next);
  assertReleaseHandoffApproval(
    next.snapshot,
    previous.releaseHandoffApproval ?? null,
  );
  assertEventPrefix(previous.events, next.events);
  const transactionPath = resolve(stateDirectory, 'transaction.json');
  writeAtomic(transactionPath, {
    version: 1,
    snapshot: next.snapshot,
    events: next.events,
    receipts: next.receipts,
  });
  applyTransaction(stateDirectory, readJson(transactionPath));
  unlinkSync(transactionPath);
};
