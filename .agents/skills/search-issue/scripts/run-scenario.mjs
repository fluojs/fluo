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
  const { runReadyScenario } = await import('./ledger.mjs');
  const result = await runReadyScenario(prepared, valueAfter('--out'));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
