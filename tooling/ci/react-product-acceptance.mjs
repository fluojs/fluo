import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { validateReviewFact } from '../../.agents/skills/review-head/scripts/contracts.mjs';
import { isValidLocalCiWaiver, localCheckBinding } from '../../.agents/skills/execute-lane/scripts/lane-v4.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const requiredRows = Object.freeze([
  'first-run', 'add-page', 'ssr', 'hydration', 'jukebox', 'dirty-history', 'error-recovery',
  'reads-search', 'crud-forms', 'post-save', 'auth-transition', 'react-css-edit',
  'server-shared-config-edit', 'deployment', 'long-session', 'soak', 'types-authoring',
  'measurements', 'docs-release', 'ci-release',
]);
const engines = ['chromium', 'firefox', 'webkit'];
const faults = ['network', 'server-error', 'slow', 'payload', 'import', 'render', 'deploy'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };
const exampleFilter = ['--filter', '@fluojs/example-react-vite-ssr'];
const productionBrowser = ['tests/production-hydration.spec.ts', 'tests/navigation-failure.spec.ts',
  'tests/deployment-transition.spec.ts', 'tests/ssr-delivery.spec.ts'];
const faultBrowser = ['tests/progressive-forms.spec.ts', 'tests/background-interactions.spec.ts',
  'tests/session-transition.spec.ts', 'tests/navigation-guard.spec.ts', 'tests/revalidation.spec.ts',
  'tests/product-faults.spec.ts'];

export function productDomainPlan(domain, output) {
  const browser = (id, files, env = {}) => ({
    id, executable: 'pnpm', args: [...exampleFilter, 'exec', 'playwright', 'test', ...files, '--reporter=json',
      `--output=${resolve(output, id)}`],
    env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(output, `${id}-report.json`) },
    browserReport: `${id}-report.json`,
  });
  const build = (id, reliability = false) => ({
    id, executable: 'pnpm', args: [...exampleFilter, reliability ? 'build:reliability' : 'build'],
    env: id === 'ordinary-build' ? {} : { REACT_VITE_FORM_TEST_SERVER: '1' },
  });
  if (domain === 'tooling') return [
    { id: 'source-http', executable: 'pnpm', args: ['vitest', 'run', 'examples/react-vite-ssr'], env: {} },
    { id: 'example-types', executable: 'pnpm', args: [...exampleFilter, 'typecheck'], env: {} },
    build('ordinary-build'),
    browser('ordinary-browser', productionBrowser),
    browser('product-browser', ['tests/product-acceptance.spec.ts']),
    build('fault-build'),
    browser('fault-browser', faultBrowser),
    build('reliability-build', true),
    { id: 'reliability-browser', executable: 'pnpm', args: [...exampleFilter, 'test:reliability'],
      env: { FLUO_RELIABILITY_SEED: '3886', FLUO_RELIABILITY_ACTIONS: '1000',
        FLUO_RELIABILITY_OUTPUT: resolve(output, 'reliability-browser'),
        FLUO_RELIABILITY_REPORT: resolve(output, 'reliability-browser-report.json') },
      browserReport: 'reliability-browser-report.json' },
  ];
  if (domain === 'starters') return [
    { id: 'packed-cold-dev', executable: 'pnpm', args: ['--dir', 'packages/cli', 'sandbox:matrix'],
      env: { FLUO_CLI_SANDBOX_PROFILE: 'full', FLUO_CLI_SANDBOX_DEPENDENCIES: 'locked' } },
    { id: 'typegen-tests', executable: 'pnpm', args: ['--filter', '@fluojs/cli', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts',
      'src/commands/typegen-projection.test.ts', 'src/commands/typegen-watch.test.ts', 'src/new/react-vite-ssr-scaffold.test.ts'], env: {} },
    { id: 'packed-product', executable: process.execPath, args: ['examples/react-vite-ssr/tests/verify-background-starter.mjs'],
      env: { FLUO_PRODUCT_ACCEPTANCE: '1', FLUO_BACKGROUND_EVIDENCE: resolve(output, 'packed-product') } },
  ];
  if (domain === 'soak') return [
    build('reliability-build', true),
    { id: 'soak-browser', executable: 'pnpm', args: [...exampleFilter, 'test:reliability', '--project', 'chromium'],
      env: { FLUO_RELIABILITY_SOAK: '1', FLUO_RELIABILITY_SOAK_PROFILE: 'lane-3886-one-hour',
        FLUO_RELIABILITY_SOAK_MS: '3600000', FLUO_RELIABILITY_SEED: '3886', FLUO_RELIABILITY_ACTIONS: '1000',
        FLUO_RELIABILITY_OUTPUT: resolve(output, 'soak-browser'),
        FLUO_RELIABILITY_REPORT: resolve(output, 'soak-browser-report.json') },
      browserReport: 'soak-browser-report.json' },
  ];
  throw new TypeError(`Unknown product evidence domain: ${domain}`);
}

/** Runs the existing domain commands and retains real exits, reports and artifacts, never external proof. */
export async function captureDomain(domain, outputDirectory) {
  const requested = resolve(outputDirectory);
  requireValue(isAbsolute(outputDirectory)
    && (requested.startsWith(`${resolve(sourceRoot, '.omo/verification/issue-3879')}/`)
      || process.env.FLUO_PRODUCT_CI === '1' && requested.startsWith('/evidence/react-product/')),
  'Local product outputs belong to a unique assigned worktree run; CI uses its canonical evidence mount');
  mkdirSync(outputDirectory, { recursive: true });
  const output = realpathSync(outputDirectory);
  requireValue(readdirSync(output).length === 0, 'Use a new output directory; never overwrite partial raw evidence');
  const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const source = { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
    clean: git('status', '--porcelain') === '' };
  requireValue(source.clean, 'Current runtime capture requires clean committed source');
  const reference = (path) => ({ path: relative(output, path), sha256: sha(readFileSync(path)) });
  const inputPaths = ['pnpm-lock.yaml', 'examples/react-vite-ssr/package.json',
    'examples/react-vite-ssr/vite.client.config.ts', 'examples/react-vite-ssr/vite.server.config.ts',
    'examples/react-vite-ssr/playwright.config.ts', 'examples/react-vite-ssr/playwright.reliability.config.ts',
    'tooling/ci/react-product-acceptance.mjs'];
  const inputDigests = Object.fromEntries(inputPaths.map((path) => [path, sha(readFileSync(resolve(sourceRoot, path)))]));
  const receipt = { version: 1, issue: 3879, domain, head: source.head, source, inputDigests,
    runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch,
      pnpm: execFileSync('pnpm', ['--version'], { cwd: sourceRoot, encoding: 'utf8',
        env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } }).trim() },
    status: 'incomplete', commands: [], checks: [], artifacts: [] };
  const receiptFile = resolve(output, `${domain}-receipt.json`);
  const save = () => writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  save();
  try {
    for (const command of productDomainPlan(domain, output)) {
      if (command.id === 'packed-product') mkdirSync(resolve(output, 'packed-product'), { recursive: true });
      const started = performance.now();
      const logPath = resolve(output, `${command.id}.log`);
      const log = createWriteStream(logPath);
      const child = spawn(command.executable, command.args, {
        cwd: sourceRoot, env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', ...command.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        log.write(chunk); process.stdout.write(chunk);
      });
      const terminate = () => child.kill('SIGTERM');
      process.once('SIGTERM', terminate);
      process.once('SIGINT', terminate);
      let outcome;
      try {
        outcome = await new Promise((complete, reject) => {
          child.once('error', reject); child.once('close', (exitCode, signal) => complete({ exitCode, signal }));
        });
      } finally {
        process.off('SIGTERM', terminate); process.off('SIGINT', terminate);
        log.end(); await finished(log);
      }
      const { exitCode, signal } = outcome;
      const observed = { id: command.id, head: source.head, status: exitCode === 0 ? 'passed' : 'failed',
        exitCode, signal, elapsedMs: performance.now() - started,
        command: [command.executable, ...command.args].join(' '), env: command.env, log: reference(logPath) };
      receipt.commands.push(observed);
      save();
      requireValue(exitCode === 0, `Product domain command failed: ${command.id} (${exitCode}); ${logPath}`);
      if (command.browserReport) {
        const reportPath = resolve(output, command.browserReport);
        browserReport(JSON.parse(readFileSync(reportPath)));
        observed.browserReport = reference(reportPath);
      }
      if (command.id.endsWith('-build')) {
        const identity = {};
        for (const path of ['dist/client/.vite/manifest.json', 'dist/server/main.js']) {
          identity[path] = sha(readFileSync(resolve(sourceRoot, 'examples/react-vite-ssr', path)));
        }
        const identityPath = resolve(output, `${command.id}-identity.json`);
        writeFileSync(identityPath, `${JSON.stringify({ head: source.head, command: observed.command,
          env: command.env, inputDigests, identity }, null, 2)}\n`);
        observed.artifacts = [reference(identityPath)];
      }
      if (command.id === 'packed-product') {
        const directory = resolve(output, 'packed-product');
        const paths = readdirSync(directory).filter((name) => /^pack-release-.*\.json$/u.test(name));
        requireValue(paths.length === 1, 'Missing/duplicate packed source receipt');
        const packedPath = resolve(directory, paths[0]);
        const packed = JSON.parse(readFileSync(packedPath));
        requireValue(packed.head === source.head && packed.status === 'passed' && packed.product === true
          && packed.source?.clean === true && packed.authoring?.manualWiring?.length === 0,
        'Packed product source/authoring incomplete');
        observed.packagedReceipt = reference(packedPath);
        receipt.checks.push({ ...observed, id: 'packed-authoring' });
        for (const id of ['packed-dev', 'packed-production', 'packed-deployment']) {
          const entries = packed.commands.filter((entry) => entry.label === id);
          requireValue(entries.length === 1 && entries[0].exit === 0 && entries[0].expectedRejection === false,
            `Missing actual packed journey: ${id}`);
          const entry = entries[0];
          browserReport(JSON.parse(readFileSync(entry.browserReport)));
          receipt.checks.push({ id, head: source.head, status: 'passed', exitCode: entry.exit,
            elapsedMs: entry.elapsedMs, command: entry.command.join(' '), env: entry.env,
            log: reference(entry.log), browserReport: reference(entry.browserReport),
            packagedReceipt: reference(packedPath) });
        }
      }
      receipt.checks.push(observed);
      save();
      requireValue(git('rev-parse', 'HEAD') === source.head && git('status', '--porcelain') === '',
        'Source changed during product domain execution');
    }
    const inventory = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) inventory(path);
        else if (entry.isFile() && path !== receiptFile) receipt.artifacts.push(reference(path));
      }
    };
    inventory(output);
    receipt.status = 'domain-evidence-complete';
  } catch (error) {
    receipt.status = 'failed';
    throw error;
  } finally { save(); }
  return receipt;
}

function artifact(root, reference) {
  requireValue(reference && typeof reference.path === 'string' && /^[a-f0-9]{64}$/u.test(reference.sha256),
    'Missing authenticated artifact reference');
  const path = realpathSync(resolve(root, reference.path));
  const inside = relative(root, path);
  requireValue(inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside), 'Artifact escaped evidence root');
  requireValue(statSync(path).isFile() && statSync(path).size > 0, 'Missing or empty artifact');
  const bytes = readFileSync(path);
  requireValue(sha(bytes) === reference.sha256, 'Artifact digest mismatch');
  return { path, bytes };
}

function browserReport(value, requiredFiles = []) {
  let tests = 0;
  const files = new Set();
  const visit = (suite) => {
    if (typeof suite.file === 'string') files.add(suite.file);
    for (const spec of suite.specs ?? []) {
      if (typeof spec.file === 'string') files.add(spec.file);
      for (const test of spec.tests ?? []) {
        tests++;
        requireValue(test.expectedStatus === 'passed' && test.status === 'expected'
          && test.results.length === 1 && test.results[0].status === 'passed',
        `Browser case missing, skipped, retried or failed: ${spec.title}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  requireValue(Array.isArray(value.suites) && (value.errors ?? []).length === 0, 'Invalid browser report');
  for (const suite of value.suites) visit(suite);
  requireValue(tests > 0, 'Empty browser execution cannot pass');
  requireValue(requiredFiles.every((required) => [...files].some((file) => file.endsWith(required))),
    'Missing mandatory browser file inventory');
  return tests;
}

export function validateMeasurementDiagnostics(value) {
  requireValue(value?.methodVersion === 'FA-V3' && ['pass', 'fail', 'inconclusive'].includes(value.verdict),
    'Missing original measurement verdict');
  requireValue(Array.isArray(value.checks) && value.checks.length > 0, 'Missing measurement inventory');
  requireValue(value.subprocessFailed !== true && value.executionFailure == null, 'Measurement runtime collection failed');
  for (const check of value.checks) {
    requireValue(['pass', 'fail', 'inconclusive'].includes(check.verdict), 'Unknown measurement verdict');
    const numeric = typeof check.metric === 'string'
      && ['within-budget', 'absolute-budget', 'relative-band', 'decision-boundary'].includes(check.reason);
    requireValue(numeric || check.verdict === 'pass', 'Measurement quality/authentication/correctness failed or inconclusive');
    if (numeric) requireValue(Array.isArray(check.range) && check.range.length === 2
      && check.range.every((number) => Number.isFinite(number) && number >= 0), 'Missing or invalid observed metric range');
    if (check.metric === 'errorRate' && check.framework === 'fluo') {
      requireValue(check.verdict === 'pass' && Array.isArray(check.range)
        && check.range.every((rate) => rate === 0), 'Fluo measured/warmup error rate must remain zero');
    }
  }
  return { originalVerdict: value.verdict, numericBlocking: false };
}

export function validateMeasurementInventory(value, rawFiles) {
  const profiles = ['desktop-native', 'desktop-matched-cache', 'tablet-native', 'tablet-matched-cache'];
  const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];
  requireValue(Array.isArray(value.receipts) && value.receipts.length === profiles.length,
    'Missing original four-profile receipts');
  for (const profile of profiles) {
    const receipts = value.receipts.filter((receipt) => receipt.profile === profile);
    requireValue(receipts.length === 1, 'Missing/duplicate measurement profile');
    const envelope = receipts[0];
    const receipt = typeof envelope.path === 'string' && !Array.isArray(envelope.runs)
      ? (() => {
        const file = rawFiles.get(envelope.path);
        requireValue(file, 'Missing original full profile receipt');
        requireValue(envelope.measuredRuns === 20 && envelope.warmups === 8, 'Incomplete server sample inventory');
        const receipt = JSON.parse(file.bytes);
        requireValue(receipt.profile === envelope.profile
          && receipt.methodBinding?.sha256 === envelope.methodBinding?.sha256, 'Profile receipt binding mismatch');
        requireValue(typeof envelope.socketTrace === 'string'
          && rawFiles.has(resolve(dirname(envelope.path), envelope.socketTrace)), 'Missing original server socket trace');
        return receipt;
      })() : envelope;
    requireValue(receipt.methodVersion === 'FA-V3' && receipt.measurementPurpose === 'integrated'
      && receipt.isolatedRepresentative === true && /^[a-f0-9]{40}$/u.test(receipt.provenance?.commit),
    'Unauthenticated original measurement source/method/environment');
    requireValue(receipt.provenance.commit === value.provenance?.commit, 'Original profile source head mismatch');
    for (const binding of [receipt.methodBinding, receipt.environmentBinding,
      ...(receipt.developmentMethodBinding ? [receipt.developmentMethodBinding, receipt.developmentEnvironmentBinding] : [])]) {
      const raw = rawFiles.get(binding?.path);
      requireValue(raw && raw.sha256 === binding.sha256, 'Missing or mismatched original method/environment artifact');
    }
    requireValue(Array.isArray(receipt.runs) && receipt.runs.length === 20
      && Array.isArray(receipt.warmups) && receipt.warmups.length === 8, 'Missing measured/warmup inventory');
    for (const framework of frameworks) {
      requireValue(receipt.runs.filter((run) => run.framework === framework).length === 5
        && receipt.warmups.filter((run) => run.framework === framework).length === 2,
      'Incomplete pinned peer/repetition inventory');
      if (receipt.developmentMethodBinding) requireValue(Array.isArray(receipt.developmentWarmups)
        && receipt.developmentWarmups.filter((run) => run.framework === framework).length === 2,
      'Incomplete development warmup inventory');
    }
    for (const run of [...receipt.runs, ...receipt.warmups, ...(receipt.developmentWarmups ?? [])]) {
      requireValue(run.profile === receipt.profile && run.mode === receipt.mode
        && frameworks.includes(run.framework) && run.correctness === 'pass' && (run.qualityFailures ?? []).length === 0
        && run.metrics && Object.keys(run.metrics).length > 0
        && Object.values(run.metrics).every((number) => Number.isFinite(number) && number >= 0)
        && (run.framework !== 'fluo' || run.metrics?.errorRate === 0
          || receipt.developmentWarmups?.includes(run) && run.metrics.errorRate === undefined),
      'Measurement correctness/quality/zero-error failure');
      const raw = rawFiles.get(run.trace);
      requireValue(raw, 'Missing original raw sample trace');
      const trace = JSON.parse(raw.bytes);
      requireValue(trace.profile === undefined || trace.profile === run.profile
        && trace.mode === run.mode && trace.framework === run.framework && trace.runId === run.runId,
      'Raw sample identity mismatch');
      requireValue((trace.qualityFailures ?? []).length === 0 && trace.correctness !== 'fail'
        && trace.correctness !== 'inconclusive', 'Raw quality failure or inconclusive correctness');
      const sources = Array.isArray(trace.sourceTraces) ? trace.sourceTraces.map((path) => {
        const file = rawFiles.get(path);
        requireValue(file, 'Missing original source trace');
        return JSON.parse(file.bytes);
      }) : [trace];
      requireValue(JSON.stringify(Object.assign({}, ...sources.map((source) => source.metrics)))
        === JSON.stringify(run.metrics), 'Raw sample metrics do not match immutable receipt');
    }
  }
}

export async function reliabilityRun(root, reference, head) {
  const file = artifact(root, reference);
  const receipt = JSON.parse(file.bytes);
  requireValue(receipt.version === 1 && receipt.issue === 3886 && receipt.head === head,
    'Reliability source/head mismatch');
  requireValue(receipt.status === 'passed' && receipt.firstFailure === null
    && engines.includes(receipt.engine) && receipt.surface === 'official-example-production',
  'Reliability failed, incomplete or wrong surface');
  requireValue(receipt.eventTrace === 'events.jsonl', 'Missing terminal raw trace');
  const trace = artifact(root, reference.trace);
  requireValue(resolve(dirname(file.path), receipt.eventTrace) === trace.path, 'Trace does not belong to receipt');
  const input = createReadStream(trace.path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let starts = 0;
  let settled = 0;
  let warmupIndex = 0;
  let measuredCheckpoints = 0;
  let terminals = 0;
  let acknowledgements = 0;
  let awaitingAck;
  let resourceId;
  let baseline;
  let last;
  const observedFaults = new Set();
  try {
    for await (const line of lines) {
      const event = JSON.parse(line);
      requireValue(event.seed === receipt.seed && Number.isSafeInteger(event.index),
        'Reliability trace seed/index mismatch');
      requireValue(!['first-failure', 'pageerror'].includes(event.phase), 'Failure in passed reliability trace');
      if (event.phase === 'start') {
        starts++;
        requireValue(event.detail.head === head && event.detail.engine === receipt.engine, 'Trace source/head mismatch');
      }
      if (event.phase === 'action-start') requireValue(awaitingAck === undefined, 'Missing settled action acknowledgement');
      if (event.phase === 'action-settled') {
        requireValue(awaitingAck === undefined && event.index === settled, 'Incomplete action/ack sequence');
        awaitingAck = ++settled;
      }
      if (event.phase === 'workload-complete') terminals++;
      if (event.phase === 'resource-ack') {
        acknowledgements++;
        resourceId ??= event.detail.id;
        requireValue(event.detail.id === resourceId && event.detail.sequence === acknowledgements
          && event.detail.acknowledgement === `${resourceId}:${acknowledgements}:ack`,
        'Missing actual resource operation/ack identity');
        if (awaitingAck !== undefined) {
          requireValue(event.index === awaitingAck, 'Wrong settled action acknowledgement');
          awaitingAck = undefined;
        }
      }
      if (event.phase === 'fault-schedule') observedFaults.add(event.detail.fault);
      if (event.phase === 'measurement') {
        if (event.detail.warmup === true) warmupIndex = event.index;
        else {
          requireValue(event.detail.warmup === false, 'Missing measurement/warmup classification');
          measuredCheckpoints++;
        }
        const { live, server, harness } = event.detail;
        requireValue(live?.actualInstanceRetained === true && live.mounts === 1 && live.cleanups === 0
          && live.ports === 2 && live.unhandled === 0 && live.pendingInteractions === 0
          && live.harnessObservers === 0 && live.pendingNavigation === false && server?.requestScopes === 0
          && server.cleanupSubscriptions === 0 && harness?.activeRequestReferences === 0,
        'Failed quiescent correctness/lifecycle/cleanup checkpoint');
        requireValue(['globalListeners', 'sockets', 'interactionOwners'].every((key) =>
          Number.isSafeInteger(live[key]) && live[key] >= 0), 'Missing live owner inventory');
        if (event.detail.warmup === false) {
          baseline ??= live;
          requireValue(['document', 'id', 'globalListeners', 'sockets', 'interactionOwners']
            .every((key) => live[key] === baseline[key]), 'Unbounded live resource owners');
        }
      }
      last = event;
    }
  } finally { lines.close(); input.destroy(); }
  requireValue(starts === 1 && terminals === 1 && last?.phase === 'workload-complete' && measuredCheckpoints > 0,
    'Missing start or truncated terminal trace');
  requireValue(settled === receipt.actionCount && last.detail.index === receipt.actionCount
    && receipt.measuredActionCount === settled - warmupIndex && receipt.measuredActionCount >= 1000,
  'Incomplete or inflated measured workload');
  requireValue(awaitingAck === undefined && acknowledgements >= settled + 1, 'Incomplete actual resource acknowledgements');
  requireValue(last.detail.elapsedMs === receipt.elapsedMs && Number.isFinite(receipt.elapsedMs)
    && receipt.elapsedMs > 0 && faults.every((fault) => observedFaults.has(fault)),
  'Duration mismatch or incomplete fault inventory');
  return receipt;
}

export function validateReliabilityInventory(correctness, soak) {
  requireValue(Array.isArray(correctness) && correctness.length === 3
    && engines.every((engine) => correctness.filter((run) => run.engine === engine && run.kind === 'correctness').length === 1),
  'Duplicate or missing correctness engine');
  requireValue(soak?.kind === 'soak' && soak.elapsedMs >= 3600000, 'Fresh one-hour terminal soak required');
}

function externalEvidence(root, receipt, head) {
  requireValue(receipt.external && typeof receipt.external.laneId === 'string', 'Missing lead-owned external proof');
  const policy = JSON.parse(artifact(root, receipt.external.policy).bytes);
  requireValue(policy.active_axes?.length === 3
    && ['contract', 'code', 'verification'].every((axis) => policy.active_axes.includes(axis)),
  'All three exact-head review axes are required');
  const review = JSON.parse(artifact(root, receipt.external.review).bytes);
  requireValue(review.head === head && typeof review.accepted_at === 'string', 'Missing recorded exact-head review');
  const validated = validateReviewFact(review.value, head, policy);
  requireValue(validated.verdict === 'pass', 'Exact-head independent review did not PASS');
  const waiver = JSON.parse(artifact(root, receipt.external.localCiWaiver).bytes);
  const binding = localCheckBinding(validated, review.accepted_at);
  requireValue(isValidLocalCiWaiver(waiver, { headSha: head, laneId: receipt.external.laneId,
    issue: 3879, contractSha256: receipt.preflightSha256, binding }), 'Invalid canonical local-ci-waiver');
  const remote = JSON.parse(artifact(root, receipt.external.remoteCi).bytes);
  requireValue(remote.run?.head_sha === head && remote.run.status === 'completed'
    && remote.run.path === '.github/workflows/ci.yml' && remote.run.conclusion === 'success'
    && Array.isArray(remote.jobs?.jobs) && remote.jobs.jobs.length > 0
    && remote.jobs.jobs.every((job) => job.status === 'completed'
      && ['success', 'skipped'].includes(job.conclusion)), 'Missing or failed exact-head full GitHub CI');
  requireValue(['Verify', 'Primary build', 'Verify task (tooling-1)', 'Verify task (starters)'].every((name) =>
    remote.jobs.jobs.some((job) => job.name === name && job.conclusion === 'success')),
  'Full canonical CI and product domain jobs are required');
  requireValue(Array.isArray(receipt.external.ciDomains) && receipt.external.ciDomains.length === 2,
    'Missing actual CI product receipt artifacts');
  const domains = receipt.external.ciDomains.map((reference) => {
    const file = artifact(root, reference);
    const domain = JSON.parse(file.bytes);
    requireValue(domain.head === head && domain.source?.head === head && domain.source.clean === true
      && domain.status === 'domain-evidence-complete' && domain.checks?.length > 0
      && domain.artifacts?.length > 0, 'Unbound or incomplete CI journey receipt');
    for (const reference of domain.artifacts) artifact(dirname(file.path), reference);
    return domain.domain;
  });
  requireValue(['tooling', 'starters'].every((name) => domains.filter((domain) => domain === name).length === 1),
    'Duplicate or missing CI evidence domain');
}

/** Consumes local proofs without asserting lead-owned reviews or remote CI have run. */
export async function consumeProduct(matrix, receipt, outputRoot, expectedHead, expectedTree) {
  const root = realpathSync(outputRoot);
  requireValue(matrix?.version === 1 && matrix.issue === 3879 && Array.isArray(matrix.rows), 'Invalid product matrix');
  requireValue(matrix.rows.length === requiredRows.length
    && requiredRows.every((id) => matrix.rows.filter((row) => row.id === id).length === 1), 'Missing/duplicate/unknown mandatory row');
  requireValue(matrix.numericPolicy === 'disclosed-nonblocking-numeric-diagnostics'
    && matrix.soakProfile === 'lane-3886-one-hour' && matrix.scheduledSoakMs === 7200000
    && matrix.physicalDevices === 'deferred-to-3906', 'Product policy mismatch');
  requireValue(receipt?.version === 1 && receipt.issue === 3879 && receipt.head === expectedHead
    && /^[a-f0-9]{40}$/u.test(expectedHead) && receipt.source?.head === expectedHead
    && receipt.source.clean === true && /^[a-f0-9]{40}$/u.test(expectedTree) && receipt.source.tree === expectedTree
    && /^[a-f0-9]{64}$/u.test(receipt.preflightSha256), 'Wrong current clean source/head binding');
  requireValue(['local', 'final'].includes(receipt.stage), 'Unknown evidence stage');
  if (receipt.stage === 'final') externalEvidence(root, receipt, expectedHead);
  requireValue(receipt.matrixSha256 === sha(Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`)),
    'Matrix identity mismatch');
  requireValue(Array.isArray(receipt.checks) && Array.isArray(receipt.rows), 'Missing executions/rows');
  const checks = new Map();
  for (const check of receipt.checks) {
    requireValue(typeof check.id === 'string' && !checks.has(check.id), 'Duplicate execution identity');
    requireValue(check.head === expectedHead && check.status === 'passed' && check.exitCode === 0
      && typeof check.command === 'string' && check.command.length > 0
      && Number.isFinite(check.elapsedMs) && check.elapsedMs >= 0, `Unverified execution: ${check.id}`);
    artifact(root, check.log);
    const requiredFiles = {
      'ordinary-browser': productionBrowser.map((path) => path.split('/').at(-1)),
      'product-browser': ['product-acceptance.spec.ts'],
      'fault-browser': faultBrowser.map((path) => path.split('/').at(-1)),
      'reliability-browser': ['long-session.spec.ts', 'long-session-ownership.spec.ts', 'long-session-cache.spec.ts',
        'background-interactions.spec.ts', 'session-transition.spec.ts', 'product-acceptance.spec.ts', 'product-faults.spec.ts'],
      'soak-browser': ['long-session-soak.spec.ts'],
      'packed-dev': ['production-hydration.spec.ts', 'background-interactions.spec.ts', 'session-transition.spec.ts',
        'navigation-guard.spec.ts', 'product-acceptance.spec.ts', 'product-faults.spec.ts', 'product-authoring.spec.ts'],
      'packed-production': ['production-hydration.spec.ts', 'background-interactions.spec.ts', 'session-transition.spec.ts',
        'navigation-guard.spec.ts', 'product-acceptance.spec.ts', 'product-faults.spec.ts', 'product-authoring.spec.ts'],
      'packed-deployment': ['deployment-transition.spec.ts'],
    }[check.id];
    requireValue(requiredFiles === undefined || check.browserReport, `Missing actual browser report: ${check.id}`);
    if (check.browserReport) browserReport(JSON.parse(artifact(root, check.browserReport).bytes), requiredFiles);
    for (const reference of check.artifacts ?? []) artifact(root, reference);
    checks.set(check.id, check);
  }
  const rows = [];
  for (const row of matrix.rows) {
    requireValue(['shipped-composition', 'product-fixture', 'shipped-harness', 'shipped-projection',
      'historical-authenticated-diagnostics', 'product-documentation', 'lead-owned-final-gate'].includes(row.implementation),
    `Unimplemented mandatory row: ${row.id}`);
    requireValue(['owner', 'success', 'failure', 'cancellation'].every((key) => typeof row[key] === 'string' && row[key].length > 0)
      && ['source', 'tests', 'prerequisites', 'surfaces', 'checks'].every((key) => Array.isArray(row[key]) && row[key].length > 0),
    `Incomplete matrix ownership/surface contract: ${row.id}`);
    const result = receipt.rows.filter((item) => item.id === row.id);
    requireValue(result.length === 1, `Missing/duplicate executed row: ${row.id}`);
    if (row.receipt === 'external' && receipt.stage === 'local') {
      requireValue(result[0].verdict === 'lead-owned-pending', 'Missing external proof cannot PASS');
      rows.push({ id: row.id, implementation: row.implementation, executionVerdict: 'lead-owned-pending' });
      continue;
    }
    requireValue(result[0].verdict === 'passed' && row.checks.every((id) => checks.has(id)), `Missing/skip/failed row: ${row.id}`);
    rows.push({ id: row.id, implementation: row.implementation, executionVerdict: 'passed' });
  }
  requireValue(receipt.rows.length === matrix.rows.length, 'Unknown executed row');
  requireValue(Array.isArray(receipt.reliability?.correctness) && receipt.reliability.correctness.length === 3,
    'Missing correctness engine inventory');
  const correctness = await Promise.all(receipt.reliability.correctness.map((ref) => reliabilityRun(root, ref, expectedHead)));
  const soak = await reliabilityRun(root, receipt.reliability.soak, expectedHead);
  validateReliabilityInventory(correctness, soak);
  requireValue(['client', 'server'].every((domain) => receipt.measurements?.originalHeads?.[domain] !== expectedHead
    && /^[a-f0-9]{40}$/u.test(receipt.measurements?.originalHeads?.[domain]))
    && Array.isArray(receipt.measurements.references) && receipt.measurements.references.length > 0
    && receipt.measurements.currentProductMeasurement === false
    && typeof receipt.measurements.limits === 'string' && receipt.measurements.limits.length > 0,
  'Unauthenticated or relabeled historical measurements');
  const measurementKinds = new Set();
  const diagnostics = [];
  const rawFiles = new Map();
  const originalVerdicts = [];
  for (const reference of receipt.measurements.references) {
    const file = artifact(root, reference);
    measurementKinds.add(reference.kind);
    if (reference.originalPath) {
      requireValue(!rawFiles.has(reference.originalPath), 'Duplicate historical raw locator');
      rawFiles.set(reference.originalPath, { ...file, sha256: reference.sha256 });
    }
    if (reference.kind === 'before-verdict' || reference.kind === 'after-verdict') {
      const verdict = JSON.parse(file.bytes);
      requireValue(['client', 'server'].includes(reference.domain), 'Missing measurement domain');
      requireValue(verdict.pairPhase === (reference.kind === 'before-verdict' ? 'before' : 'after')
        && verdict.provenance?.commit !== expectedHead
        && (reference.kind !== 'after-verdict'
          || verdict.provenance.commit === receipt.measurements.originalHeads[reference.domain]),
      'Relabeled original measurement head/phase');
      originalVerdicts.push(verdict);
      diagnostics.push({ kind: reference.kind, domain: reference.domain, ...validateMeasurementDiagnostics(verdict) });
    }
  }
  requireValue(['before-verdict', 'after-verdict', 'raw-inventory', 'method', 'baseline', 'lockfile', 'source', 'quality-authentication']
    .every((kind) => measurementKinds.has(kind)) && ['client', 'server'].every((domain) =>
      ['before-verdict', 'after-verdict'].every((kind) => diagnostics.filter((item) => item.domain === domain && item.kind === kind).length === 1)),
  'Incomplete original measurement inventory');
  for (const verdict of originalVerdicts) validateMeasurementInventory(verdict, rawFiles);
  requireValue(Array.isArray(receipt.measurements.seams) && receipt.measurements.seams.length > 0,
    'Missing historical source seam equivalence and limits');
  for (const seam of receipt.measurements.seams) {
    requireValue(typeof seam.path === 'string'
      && ['tooling/benchmarks/react-app-comparison/', 'packages/react/src/', 'packages/http/src/']
        .some((prefix) => seam.path.startsWith(prefix)) && !seam.path.split('/').includes('..'),
    'Unknown historical seam source');
    const old = artifact(root, seam.original);
    const current = sha(readFileSync(resolve(sourceRoot, seam.path)));
    requireValue(current === seam.currentSha256 && /^[a-f0-9]{40}$/u.test(seam.originalHead)
      && seam.originalHead !== expectedHead, 'Historical seam source/head mismatch');
    requireValue(seam.relation === (sha(old.bytes) === current ? 'unchanged' : 'changed')
      && typeof seam.limits === 'string' && seam.limits.length > 0,
    'Unproven or undisclosed historical seam equivalence');
  }
  requireValue(receipt.measurements.quality === 'passed' && receipt.measurements.authentication === 'passed'
    && receipt.measurements.correctness === 'passed' && receipt.measurements.cleanup === 'passed',
  'Measurement authentication/quality/correctness/cleanup is blocking');
  return { version: 1, issue: 3879, head: expectedHead, status: receipt.stage === 'local'
    ? 'local-evidence-complete' : 'product-evidence-complete', rows, diagnostics,
  physicalDevices: 'deferred-to-3906', scheduledSoakMs: 7200000 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [matrixPath, receiptPath, outputRoot] = process.argv.slice(2);
  if (matrixPath === 'capture') {
    requireValue(receiptPath && outputRoot, 'Usage: node tooling/ci/react-product-acceptance.mjs capture <tooling|starters|soak> <artifact-root>');
    const result = await captureDomain(receiptPath, outputRoot);
    console.log(JSON.stringify({ domain: result.domain, head: result.head, status: result.status }));
  } else {
  requireValue(matrixPath && receiptPath && outputRoot, 'Usage: node tooling/ci/react-product-acceptance.mjs <matrix.json> <receipt.json> <artifact-root>');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  requireValue(execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim() === '',
    'Product receipt consumption requires clean committed source');
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const result = await consumeProduct(JSON.parse(readFileSync(matrixPath)), JSON.parse(readFileSync(receiptPath)), outputRoot, head, tree);
  console.log(JSON.stringify(result, null, 2));
  }
}
