#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

import { assert } from './lane-ledger-contract.mjs';
import { validateLedger } from './lane-ledger-state.mjs';

const paths = process.argv.slice(2).filter((path) => path !== '--');
if (paths.length === 0) {
  console.error('Usage: node tooling/governance/verify-lane-ledger.mjs <ledger.json> [...]');
  process.exit(2);
}

for (const path of paths) {
  assert(existsSync(path), path, 'ledger file does not exist');
  validateLedger(path, JSON.parse(readFileSync(path, 'utf8')));
}

console.log(`Lane ledger check passed for ${String(paths.length)} file(s).`);
