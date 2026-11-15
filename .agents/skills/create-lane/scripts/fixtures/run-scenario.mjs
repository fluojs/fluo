import { resolve } from 'node:path';

import { prepareScenario } from '../contracts.mjs';
import { publishPreparedLane } from '../publication.mjs';

const args = process.argv.slice(2);
if (!args.includes('--fixture-only')) {
  throw new TypeError(
    'run-scenario.mjs is a fixture-only contract exerciser; production approvals come from the trusted lead.',
  );
}
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) throw new TypeError(`Missing ${flag}.`);
  return value;
};

const prepared = prepareScenario(valueAfter('--scenario'));
const result = publishPreparedLane(resolve(valueAfter('--out')), prepared);
process.stdout.write(`${JSON.stringify(result)}\n`);
