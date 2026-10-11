// Reuse the finite HTTP orchestration; observe requested phases without replacing traffic.
import { writeFile } from 'node:fs/promises';
import { pairedEnvironment } from '../../results/issue-3914/paired-ab.mjs';
import { nodeSubject } from '../../results/issue-3914/paired-node.mjs';
import { LocalLoadSession } from '../../src/load';

const subject = nodeSubject({
  schema: 'paired-node-180-v1', mode: 'calibration', condition: { platform: 'nodejs' },
});
for (const [key, value] of Object.entries(pairedEnvironment(subject))) process.env[key] = value;
const durations: number[] = [];
const amounts: (number | undefined)[] = [];
const load = LocalLoadSession.prototype.load;
LocalLoadSession.prototype.load = function (options, label) {
  durations.push(options.duration);
  amounts.push(options.amount);
  return load.call(this, options, label);
};
await import('./paired-node-child.mjs');
await writeFile(`${process.argv[3]}.profile.json`, JSON.stringify({
  schema: subject.schema, durations, amounts,
}), { flag: 'wx' });
