import { readFileSync } from 'node:fs';

import { prepareRun } from './contracts.mjs';
import { assertLedger, domain } from './ledger-contract.mjs';
import { collectResult, createDrafts, createLedger, startInvocation } from './ledger.mjs';
import { githubTransport, registerLedger } from './registration.mjs';
import { publishLedger, runStore } from './runtime-store.mjs';

const [command, ...args] = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1]) throw new TypeError(`Missing ${flag}.`);
  return args[index + 1];
};
const input = () => JSON.parse(readFileSync(value('--input'), 'utf8'));
let store;
let ledger;
try {
  if (command === 'init') {
    const data = input();
    if (Object.keys(data).some((key) => !['run_id', 'repository', 'authority', 'intake'].includes(key))) {
      throw new TypeError('Synthetic inputs require --fixture-only on run-scenario.mjs.');
    }
    const prepared = prepareRun(data);
    if (prepared.kind !== 'ready') throw new TypeError(JSON.stringify(prepared.result));
    const initial = createLedger(prepared);
    store = runStore(value('--root'), value('--out'));
    store.init(initial);
  } else {
    store = runStore(value('--root'), value('--out'));
    ledger = store.read();
    if (ledger.status === 'blocked' && !['resume', 'block'].includes(command)) {
      throw new TypeError('Resume the blocked run explicitly before continuing.');
    }
    switch (command) {
      case 'start':
        ledger = startInvocation(ledger, value('--invocation'), value('--task-id'));
        break;
      case 'collect':
        ledger = collectResult(ledger, input());
        break;
      case 'drafts':
        ledger = createDrafts(ledger, domain);
        break;
      case 'triage':
        if (ledger.status !== 'triage' || ledger.registration_triage.length !== 0) {
          throw new TypeError('Triage requires stable drafts without a prior decision.');
        }
        ledger = assertLedger({ ...ledger, registration_triage: input(), status: 'registering' });
        break;
      case 'register':
        if (!['registering', 'completed'].includes(ledger.status)) throw new TypeError('Triage required.');
        ledger = registerLedger({
          domain, ledger, transport: githubTransport(ledger), save: store.save,
        }).ledger;
        break;
      case 'publish':
        ledger = publishLedger(ledger, store);
        break;
      case 'block':
        ledger = assertLedger({ ...ledger, status: 'blocked', blocked_reason: value('--reason') });
        break;
      case 'resume':
        if (ledger.status !== 'blocked') break;
        ledger = assertLedger({
          ...ledger, blocked_reason: null,
          status: ledger.handoff !== null ? 'completed' :
            ledger.registration_triage.length ? 'registering' : ledger.drafts.length ? 'triage' : 'running',
        });
        break;
      default:
        throw new TypeError(`Unknown command: ${command}.`);
    }
    store.save(ledger);
  }
  process.stdout.write(`${JSON.stringify(store.read())}\n`);
} catch (error) {
  // Only validated state can be rewritten. Preserve the last saved receipts
  // when a later registration fails.
  if (ledger !== undefined) {
    const current = store.read();
    store.save({ ...current, status: 'blocked',
      blocked_reason: error instanceof Error ? error.message : String(error) });
  }
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
} finally {
  store?.close();
}
