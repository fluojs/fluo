import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  assertIssueDagBundle,
} from './issue-dag-contracts.mjs';
import {
  assertRealFile,
  atomicWrite,
  issueDirectory,
  withIssueLease,
} from './issue-supervisor-files.mjs';

const stateFilename = 'dag-state.json';
const eventsFilename = 'dag-events.jsonl';

const readBundle = (directory) => {
  const statePath = resolve(directory, stateFilename);
  const eventsPath = resolve(directory, eventsFilename);
  if (!existsSync(statePath) && !existsSync(eventsPath)) return null;
  assertRealFile(statePath);
  assertRealFile(eventsPath);
  const events = readFileSync(eventsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const projected = events.at(-1)?.state;
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  return assertIssueDagBundle({
    state:
      payloadDigest(persisted) === payloadDigest(projected)
        ? persisted
        : projected,
    events,
  });
};

export const loadIssueDagRunBundle = (
  runtimeRoot,
  laneId,
  issueNumber,
) => readBundle(issueDirectory(runtimeRoot, laneId, issueNumber));

export const persistIssueDagRunBundle = (runtimeRoot, bundle) => {
  assertIssueDagBundle(bundle);
  const directory = issueDirectory(
    runtimeRoot,
    bundle.state.lane_id,
    bundle.state.issue_number,
  );
  return withIssueLease(directory, () => {
    const existing = readBundle(directory);
    if (existing !== null) {
      const prefix = bundle.events.slice(0, existing.events.length);
      if (payloadDigest(prefix) !== payloadDigest(existing.events)) {
        throw new TypeError(
          'Issue DAG event history conflicts with persisted state.',
        );
      }
      if (payloadDigest(existing) === payloadDigest(bundle)) return existing;
    }
    atomicWrite(
      resolve(directory, eventsFilename),
      `${bundle.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    );
    atomicWrite(
      resolve(directory, stateFilename),
      `${JSON.stringify(bundle.state)}\n`,
    );
    return bundle;
  });
};
