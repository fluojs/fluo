import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runReplay } from './state-machine.mjs';
import {
  acquireLease,
  loadState,
  persistState,
} from './state-store.mjs';

const args = process.argv.slice(2);
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
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const previous = loadState(stateDirectory, ledgerPath);
const lease = acquireLease(stateDirectory, previous.snapshot.lane_id);

try {
  const result = runReplay(scenario, previous);
  persistState(stateDirectory, previous, result);
  lease.release('succeeded');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  lease.release('failed');
  throw error;
}
