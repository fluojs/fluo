#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binDirectory = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(binDirectory, '..', 'src', 'cli.ts');

const result = spawnSync(process.execPath, ['--import', 'tsx', cliEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
