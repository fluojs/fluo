import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runReplay } from './state-machine.mjs';

const args = process.argv.slice(2);
const scenarioIndex = args.indexOf('--scenario');
const scenarioPath = scenarioIndex === -1 ? undefined : args[scenarioIndex + 1];

if (scenarioPath === undefined) {
  throw new TypeError('Usage: run-replay.mjs --scenario <fixture.json>.');
}

const scenario = JSON.parse(readFileSync(resolve(scenarioPath), 'utf8'));
process.stdout.write(`${JSON.stringify(runReplay(scenario), null, 2)}\n`);
