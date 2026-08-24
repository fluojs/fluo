import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { prepareScenario } from './contracts.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

const prepared = prepareScenario(valueAfter('--scenario'));
if (prepared.kind === 'rejected') {
  process.stdout.write(`${JSON.stringify(prepared.result)}\n`);
} else {
  const outputRoot = resolve(valueAfter('--out'));
  const relativeTarget = `.omo/lanes/${prepared.plan.lane_id}.json`;
  const laneDirectory = resolve(outputRoot, '.omo/lanes');
  const target = resolve(outputRoot, relativeTarget);
  const candidate = resolve(
    laneDirectory,
    `.${prepared.plan.lane_id}.${randomUUID()}.tmp`,
  );
  mkdirSync(laneDirectory, { recursive: true });
  writeFileSync(candidate, `${JSON.stringify(prepared.plan, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  let result;
  try {
    linkSync(candidate, target);
    result = { status: 'ready', ledger: relativeTarget };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      result = { status: 'rejected', reason: 'target_collision' };
    } else {
      throw error;
    }
  } finally {
    unlinkSync(candidate);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
