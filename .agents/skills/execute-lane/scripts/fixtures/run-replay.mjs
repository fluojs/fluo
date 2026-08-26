import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { runReplay } from '../state-machine.mjs';
import { acquireLease } from '../lane-lease.mjs';
import {
  loadFixtureState,
  persistState,
} from '../state-store.mjs';

const args = process.argv.slice(2);
if (!args.includes('--fixture-only')) {
  throw new TypeError(
    'run-replay.mjs is a fixture-only state-machine exerciser; production observations must come from live Git and GitHub commands.',
  );
}
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

const scenarioPath = resolve(valueAfter('--scenario'));
const ledgerPath = resolve(valueAfter('--ledger'));
const stateDirectory = resolve(valueAfter('--state-dir'));
const repositoryRootIndex = args.indexOf('--repository-root');
const repositoryRoot =
  repositoryRootIndex === -1
    ? resolve(dirname(ledgerPath), '../..')
    : resolve(valueAfter('--repository-root'));
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
if (
  typeof scenario !== 'object' ||
  scenario === null ||
  !Array.isArray(scenario.steps) ||
  scenario.steps.length === 0
) {
  throw new TypeError('scenario.steps must be a non-empty array.');
}

let result;
for (const step of scenario.steps) {
  const previous = loadFixtureState(
    stateDirectory,
    ledgerPath,
    repositoryRoot,
  );
  const lease = acquireLease(stateDirectory, previous.snapshot.lane_id);
  try {
    result = runReplay({ ...scenario, steps: [step] }, previous);
    persistState(stateDirectory, previous, result);
    lease.release('succeeded');
  } catch (error) {
    lease.release('failed');
    throw error;
  }
  if (
    result.status === 'dependency-blocked' ||
    result.status === 'blocked-maintainer-decision' ||
    result.status === 'done' ||
    String(result.status).startsWith('blocked-') ||
    String(result.status).endsWith('-terminal')
  ) {
    break;
  }
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
