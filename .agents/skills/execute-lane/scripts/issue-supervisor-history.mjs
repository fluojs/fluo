import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { assertRealFile } from './issue-supervisor-files.mjs';

const assertEventChain = (events) => {
  if (!Array.isArray(events)) {
    throw new TypeError('issue supervisor events must be an array.');
  }
  events.forEach((event, index) => {
    const { event_hash: eventHash, ...base } = event;
    if (
      event.sequence !== index + 1 ||
      event.previous_hash !== (events[index - 1]?.event_hash ?? null) ||
      eventHash !== payloadDigest(base)
    ) {
      throw new TypeError('issue supervisor event hash chain is invalid.');
    }
  });
};

const containsInOrder = (kinds, required) => {
  let index = 0;
  for (const kind of kinds) {
    if (kind === required[index]) {
      index += 1;
    }
  }
  return index === required.length;
};

export const assertSupervisorHistory = (snapshot, events) => {
  assertEventChain(events);
  const first = events[0];
  if (
    first?.kind !== 'initialised' ||
    first.status !== 'implementing' ||
    first.head_sha !== snapshot.starting_head_sha
  ) {
    throw new TypeError('issue supervisor history must start with initialisation.');
  }
  if (
    events.some(
      (event) =>
        event.lane_id !== snapshot.lane_id ||
        event.issue_number !== snapshot.issue_number,
    )
  ) {
    throw new TypeError('issue supervisor history identity is inconsistent.');
  }
  const last = events.at(-1);
  if (
    last.status !== snapshot.status ||
    last.head_sha !== snapshot.head_sha
  ) {
    throw new TypeError(
      'issue supervisor event history does not match its snapshot.',
    );
  }
  const required =
    snapshot.status === 'done' || snapshot.status === 'blocked-terminal'
      ? [
          'initialised',
          'implementation-completed',
          'local-review',
          'pr-observed',
          'ci-observed',
          'merge-observed',
          'cleanup-observed',
        ]
      : snapshot.status === 'blocked-maintainer-decision'
        ? ['initialised', 'release-handoff']
        : snapshot.status === 'blocked-budget-exhausted'
          ? [
              'initialised',
              'implementation-completed',
              'local-review',
              'fix-completed',
            ]
          : snapshot.status === 'needs-human-check-terminal' &&
              snapshot.pr !== null
            ? [
                'initialised',
                'implementation-completed',
                'local-review',
                'pr-observed',
                'ci-observed',
              ]
            : ['initialised', 'implementation-completed', 'local-review'];
  if (
    [
      'done',
      'needs-human-check-terminal',
      'blocked-terminal',
      'blocked-budget-exhausted',
      'blocked-maintainer-decision',
    ].includes(snapshot.status) &&
    !containsInOrder(
      events.map((event) => event.kind),
      required,
    )
  ) {
    throw new TypeError(
      'issue supervisor history does not prove its terminal lifecycle.',
    );
  }
};

export const eventFor = (previous, transition, snapshot) => {
  const base = {
    version: 1,
    sequence: previous.length + 1,
    previous_hash: previous.at(-1)?.event_hash ?? null,
    kind: transition.kind,
    lane_id: snapshot.lane_id,
    issue_number: snapshot.issue_number,
    status: snapshot.status,
    head_sha: snapshot.head_sha,
    transition_sha256: payloadDigest(transition),
  };
  return { ...base, event_hash: payloadDigest(base) };
};

export const persistedEventHash = (directory, filename) => {
  const path = resolve(directory, filename);
  if (!existsSync(path)) {
    return null;
  }
  assertRealFile(path);
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  return lines.length === 0 ? null : JSON.parse(lines.at(-1)).event_hash;
};
