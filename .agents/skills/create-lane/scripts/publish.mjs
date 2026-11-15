import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { preparePublication } from './contracts.mjs';
import { publishPreparedLane } from './publication.mjs';

const { values } = parseArgs({
  options: { input: { type: 'string' }, root: { type: 'string' } },
});
if (!values.input || !values.root) throw new TypeError('Required: --input <trusted-lead-input.json> --root <repository-root>.');
const input = JSON.parse(readFileSync(values.input, 'utf8'));
const prepared = preparePublication(input, values.root);
const result = publishPreparedLane(values.root, prepared);
process.stdout.write(`${JSON.stringify(result)}\n`);
