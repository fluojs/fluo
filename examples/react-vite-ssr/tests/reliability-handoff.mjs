import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const engines = ['chromium', 'firefox', 'webkit'];
const requiredCompanions = [
  'build', 'source-tests', 'http', 'ownership', 'cache', 'native',
  'packaged-dev', 'packaged-production', 'docs', 'ci-plan',
  'contract-review', 'code-review', 'verification-review', 'remote-ci',
];
const scenarios = ['navigation', 'search', 'row', 'history', 'fault-recovery', 'auth', 'reload', 'resource-ack'];
const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };

function artifact(root, path) {
  requireValue(typeof path === 'string' && path.length > 0, 'Missing artifact path');
  const actual = realpathSync(resolve(root, path));
  const inside = relative(root, actual);
  requireValue(inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside), 'Artifact escaped output root');
  requireValue(statSync(actual).isFile() && statSync(actual).size > 0, 'Missing or empty artifact');
  return actual;
}

async function readRun(root, path, head) {
  const file = artifact(root, path);
  const receipt = JSON.parse(readFileSync(file, 'utf8'));
  requireValue(receipt.version === 1 && receipt.issue === 3886 && receipt.head === head, 'Wrong run identity');
  requireValue(receipt.status === 'passed' && receipt.firstFailure === null, 'Run failed or incomplete');
  requireValue(Number.isSafeInteger(receipt.actionCount) && receipt.actionCount >= 1000, 'Incomplete action workload');
  requireValue(Number.isSafeInteger(receipt.measuredActionCount) && receipt.measuredActionCount >= 1000,
    'Warmup cannot substitute for the measured workload');
  requireValue(engines.includes(receipt.engine), 'Unsupported engine receipt');
  requireValue(Number.isFinite(receipt.elapsedMs) && receipt.elapsedMs > 0, 'Missing elapsed duration');
  requireValue(receipt.eventTrace === 'events.jsonl', 'Unexpected trace identity');
  const trace = artifact(root, resolve(dirname(file), receipt.eventTrace));
  const input = createReadStream(trace);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const hash = createHash('sha256');
  let settled = 0;
  let measurements = 0;
  let starts = 0;
  let start = null;
  let last = null;
  const faults = new Set();
  try {
    for await (const line of lines) {
      hash.update(`${line}\n`);
      const event = JSON.parse(line);
      requireValue(event.seed === receipt.seed && Number.isSafeInteger(event.index), 'Trace seed/index mismatch');
      requireValue(event.phase !== 'first-failure' && event.phase !== 'pageerror', 'Failure in supposedly passed trace');
      if (event.phase === 'start') { starts++; start = event; }
      if (event.phase === 'action-settled') settled++;
      if (event.phase === 'measurement') measurements++;
      if (event.phase === 'fault-schedule') faults.add(event.detail.fault);
      last = event;
    }
  } finally { lines.close(); input.destroy(); }
  requireValue(starts === 1, 'Missing or duplicate trace start');
  requireValue(start.detail?.head === receipt.head, 'Wrong trace head');
  requireValue(start.detail?.engine === receipt.engine, 'Wrong trace engine');
  requireValue(last?.phase === 'workload-complete' && last.detail.index === receipt.actionCount
    && settled === receipt.actionCount && measurements > 0, 'Truncated or inconsistent trace');
  requireValue(Number.isFinite(last.detail.elapsedMs) && last.detail.elapsedMs > 0, 'Missing trace workload duration');
  requireValue(last.detail.elapsedMs === receipt.elapsedMs, 'Trace/receipt duration mismatch');
  requireValue(['network', 'server-error', 'slow', 'payload', 'import', 'render', 'deploy']
    .every((fault) => faults.has(fault)), 'Incomplete fault coverage');
  return { ...receipt, elapsedMs: last.detail.elapsedMs, receiptPath: file, traceSha256: hash.digest('hex') };
}

/** Fail closed on missing physical evidence; desktop emulation never closes #3879. */
export async function consumeHandoff(value, outputRoot) {
  const root = realpathSync(outputRoot);
  requireValue(value?.version === 1 && /^[a-f0-9]{40}$/u.test(value.head), 'Missing exact head');
  requireValue(Array.isArray(value.correctnessReceipts) && value.correctnessReceipts.length === 3,
    'All three correctness engines are required');
  const correctness = await Promise.all(value.correctnessReceipts.map((path) => readRun(root, path, value.head)));
  requireValue(engines.every((engine) => correctness.filter((run) => run.engine === engine && run.kind === 'correctness'
    && run.surface === 'official-example-production').length === 1),
    'Duplicate or missing correctness engines');
  const soak = await readRun(root, value.soakReceipt, value.head);
  requireValue(soak.kind === 'soak' && soak.surface === 'official-example-production'
    && soak.elapsedMs >= 7_200_000, 'Separate two hour soak required');
  requireValue(Array.isArray(value.companionEvidence), 'Missing companion evidence');
  for (const kind of requiredCompanions) {
    const companion = value.companionEvidence.find((item) => item.kind === kind);
    requireValue(companion?.head === value.head && companion.status === 'passed', `Unverified companion: ${kind}`);
    // The lead records normalized head/status envelopes alongside the original raw artifact.
    const raw = JSON.parse(readFileSync(artifact(root, companion.receipt), 'utf8'));
    requireValue(raw.head === value.head && raw.status === 'passed' && typeof raw.artifact === 'string',
      `Unbound companion: ${kind}`);
    artifact(root, raw.artifact);
  }
  requireValue(Array.isArray(value.physicalDevices), 'Physical device evidence remains unverified');
  if (value.physicalDeferral !== undefined) {
    requireValue(value.physicalDeferral?.issue === 'https://github.com/fluojs/fluo/issues/3906'
      && value.physicalDeferral.status === 'deferred' && value.physicalDevices.length === 0,
    'Invalid physical deferral');
    return { version: 1, issue: 3886, consumer: 3879, head: value.head,
      status: 'automated-evidence-complete', correctness, soak, physicalDevices: [],
      physicalDeferral: value.physicalDeferral, companionEvidence: value.companionEvidence };
  }
  for (const kind of ['mobile', 'tablet']) {
    const device = value.physicalDevices.find((item) => item.kind === kind && item.physical === true);
    requireValue(device?.head === value.head && device.result === 'passed'
      && ['model', 'os', 'browser', 'version', 'operator'].every((key) => typeof device[key] === 'string' && device[key].length > 0)
      && scenarios.every((scenario) => device.scenarios?.includes(scenario)), `Unverified physical ${kind}`);
    artifact(root, device.artifact);
  }
  return { version: 1, issue: 3886, consumer: 3879, head: value.head,
    status: 'evidence-complete', correctness, soak, physicalDevices: value.physicalDevices,
    companionEvidence: value.companionEvidence };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, root] = process.argv.slice(2);
  if (!input || !root) throw new TypeError('Usage: node tests/reliability-handoff.mjs <handoff.json> <output-root>');
  const result = await consumeHandoff(JSON.parse(readFileSync(input, 'utf8')), root);
  console.log(JSON.stringify(result, null, 2));
}
