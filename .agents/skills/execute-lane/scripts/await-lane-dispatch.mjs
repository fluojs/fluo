import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { awaitLaneSupervisorDispatch } from './lane-dispatch.mjs';
import {
  canonicalLaneLedgerPath,
  canonicalLaneRuntimeRoot,
} from './lane-runtime-paths.mjs';
import { loadState } from './state-store.mjs';

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

export const awaitCanonicalLaneDispatch = async ({
  repositoryRoot,
  ledgerPath,
  timeoutMs = 30_000,
}) => {
  const canonical = canonicalLaneLedgerPath(
    repositoryRoot,
    ledgerPath,
  );
  const lane = JSON.parse(readFileSync(canonical.ledgerPath, 'utf8'));
  if (lane.lane_id !== canonical.laneId) {
    throw new TypeError(
      'lane ledger identity does not match its canonical path.',
    );
  }
  const runtimeRoot = canonicalLaneRuntimeRoot(
    canonical.repositoryRoot,
  );
  const stateDirectory = resolve(runtimeRoot, canonical.laneId);
  const persisted = loadState(
    stateDirectory,
    canonical.ledgerPath,
    canonical.repositoryRoot,
  );
  return awaitLaneSupervisorDispatch({
    persisted,
    repository_root: canonical.repositoryRoot,
    timeout_ms: timeoutMs,
  });
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Usage: node await-lane-dispatch.mjs --root <repository> --ledger <lane-ledger> [--timeout-ms <milliseconds>]\n',
    );
    process.exit(0);
  }
  const result = await awaitCanonicalLaneDispatch({
    repositoryRoot: valueAfter(args, '--root'),
    ledgerPath: valueAfter(args, '--ledger'),
    timeoutMs: Number(
      args.includes('--timeout-ms')
        ? valueAfter(args, '--timeout-ms')
        : 30_000,
    ),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: 'attached',
      run_id: result.run_id,
      binding: result.binding,
    })}\n`,
  );
}
