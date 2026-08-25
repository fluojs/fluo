import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  assertContract,
  assertEventChain,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  assertHandoffProvenance,
  assertImmutableLaneBinding,
} from './handoff-provenance.mjs';
import {
  loadCanonicalHandoffContext,
  loadFixtureHandoffContext,
} from './handoff-files.mjs';
import { assertReleaseHandoffBinding } from './release-handoff-approval.mjs';

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

const loadStateInternal = ({
  stateDirectory,
  ledgerPath,
  repositoryRoot,
  canonicalBoundary,
}) => {
  const canonicalSnapshot = readJson(ledgerPath);
  validateState({
    snapshot: canonicalSnapshot,
    events: [],
    receipts: [],
  });
  const canonicalContext = canonicalBoundary
    ? loadCanonicalHandoffContext(
        repositoryRoot,
        ledgerPath,
        canonicalSnapshot,
      )
    : null;
  ensureStateDirectory(stateDirectory);
  recoverTransaction(stateDirectory);
  const snapshotPath = resolve(stateDirectory, 'snapshot.json');
  const snapshot = existsSync(snapshotPath)
    ? readJson(snapshotPath)
    : canonicalSnapshot;
  const events = readEvents(resolve(stateDirectory, 'events.jsonl'));
  const receiptsPath = resolve(stateDirectory, 'receipts.json');
  const receipts = existsSync(receiptsPath) ? readJson(receiptsPath) : [];
  const state = { snapshot, events, receipts };
  validateState(state);
  const handoffContext =
    canonicalContext ??
    loadFixtureHandoffContext(
        repositoryRoot,
        snapshot,
        canonicalSnapshot,
      );
  assertImmutableLaneBinding(snapshot, canonicalSnapshot);
  return { ...state, canonicalSnapshot, handoffContext };
};

export const loadState = (
  stateDirectory,
  ledgerPath,
  repositoryRoot = resolve(dirname(ledgerPath), '../..'),
) =>
  loadStateInternal({
    stateDirectory,
    ledgerPath,
    repositoryRoot,
    canonicalBoundary: true,
  });

export const loadFixtureState = (
  stateDirectory,
  ledgerPath,
  repositoryRoot = resolve(dirname(ledgerPath), '../..'),
) =>
  loadStateInternal({
    stateDirectory,
    ledgerPath,
    repositoryRoot,
    canonicalBoundary: false,
  });

export const persistState = (stateDirectory, previous, next) => {
  validateState(next);
  const context = previous.handoffContext;
  if (context?.approvalReceipts !== undefined) {
    assertHandoffProvenance({
      ledger: next.snapshot,
      receipts: context.approvalReceipts,
      artifact: context.artifact,
      artifactPath: context.artifactPath,
    });
  }
  if (
    context?.receipt !== undefined ||
    next.snapshot.release_handoffs.length > 0 ||
    next.snapshot.lane_plan_approval_sha256 !== undefined
  ) {
    if (context === null || context === undefined) {
      throw new TypeError('release handoff approval context is missing');
    }
    const lanePlanReceipt =
      context.approvalReceipts?.[2] ?? context.receipt;
    assertReleaseHandoffBinding(
      next.snapshot,
      lanePlanReceipt,
      context.artifact,
      context.artifactPath,
    );
  }
  assertImmutableLaneBinding(
    next.snapshot,
    previous.canonicalSnapshot ?? previous.snapshot,
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
