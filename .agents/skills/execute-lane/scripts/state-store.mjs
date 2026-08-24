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

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

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
  const content = readFileSync(path, 'utf8').trim();
  return content === ''
    ? []
    : content.split('\n').map((line) => JSON.parse(line));
};

export const loadState = (stateDirectory, ledgerPath) => {
  ensureStateDirectory(stateDirectory);
  const snapshotPath = resolve(stateDirectory, 'snapshot.json');
  const snapshot = existsSync(snapshotPath)
    ? readJson(snapshotPath)
    : readJson(ledgerPath);
  const events = readEvents(resolve(stateDirectory, 'events.jsonl'));
  const receiptsPath = resolve(stateDirectory, 'receipts.json');
  const receipts = existsSync(receiptsPath) ? readJson(receiptsPath) : [];
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
  return { snapshot, events, receipts };
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
  assertContract('lane-ledger-v2', next.snapshot);
  validateLedger('lane-ledger-v2', next.snapshot);
  assertEventChain(next.events);
  for (const receipt of next.receipts) {
    assertContract('receipt', receipt);
  }
  const prefixMatches =
    previous.events.length <= next.events.length &&
    previous.events.every(
      (event, index) =>
        event.event_hash === next.events[index]?.event_hash,
    );
  if (!prefixMatches) {
    throw new TypeError('persisted event history must remain an exact prefix.');
  }
  const newEvents = next.events.slice(previous.events.length);
  if (newEvents.length > 0) {
    appendFileSync(
      resolve(stateDirectory, 'events.jsonl'),
      `${newEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    );
  }
  writeAtomic(resolve(stateDirectory, 'snapshot.json'), next.snapshot);
  writeAtomic(resolve(stateDirectory, 'receipts.json'), next.receipts);
};
