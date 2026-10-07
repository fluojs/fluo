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

// These titles are Playwright report identifiers, not display-copy assertions.
const commonCaseTitles = {
  "background-interactions.spec.ts": [
    'real held searches complete out of order while an independent widget and shell remain usable',
    'two held row POSTs keep independent outcomes and confirm writes without history navigation',
    'actual page unmount settles its held row without reviving an old route or replaying POST',
    'native GET search and POST 303 GET queue remain usable without JavaScript',
    'a held shell widget survives approved tagged push replace back forward and explicit refresh',
    'two successful row writes acknowledge in reverse order and coalesce one latest page approval',
    'a live shell widget survives page approval while the departing page row does not',
    'logout closes the real shell ports and revokes held background results before late acknowledgements'
  ],
  "navigation-guard.spec.ts": [
    'stay and proceed preserve the actual editing DOM, head and operational shell before HTTP permission',
    'real backward and forward cancellation restore managed entry order without destination reads',
    'two actual POST acknowledgements settle out of order without overriding dirty navigation intent',
    'an open dirty decision cannot postpone explicit logout or actual resource cleanup'
  ],
  "product-acceptance.spec.ts": [
    'authenticated product: enhanced invalid/correct/save/logout/relogin -> confirmed persistence and revocation',
    'authenticated product: js-disabled -> native POST303GET validation CRUD and relogin',
    'authenticated product: bootstrap-blocked -> native POST303GET validation CRUD and relogin'
  ],
  "product-faults.spec.ts": [
    'authenticated product: logout during handler save -> old continuation revoked without rollback claim',
    'authenticated product: logout during commit save -> old continuation revoked without rollback claim',
    'authenticated product: credentialed permission refusal -> forbidden identity and fresh relogin'
  ]
};
const exampleCaseTitles = {
  ...commonCaseTitles,
  "deployment-transition.spec.ts": [
    'serves direct HTML, negotiated v2, guarded writes and missing assets through real HTTP',
    'retains A assets and shell on B mismatch, then explicitly updates to B',
    'classifies a missing mapped A chunk as import failure without losing the shell'
  ],
  "navigation-failure.spec.ts": [
    'preserves a functional resource and approved page across network failure and fresh retry',
    'preserves a functional resource and approved page across server-error failure and fresh retry',
    'explicit document exit remains available after a preserved failure',
    'failed back and forward restore the approved history entry and remain traversable',
    'invalidation during back approval restores the approved URL without remounting the shell',
    'default navigation invalidation loads the activated document for an untagged back entry',
    'a rejected replace does not commit URL or params before retry',
    'repeated failures remain actionable without remounting the shell resource',
    'a recoverable chunk import failure keeps the page and offers document recovery'
  ],
  "production-hydration.spec.ts": [
    'hydrates streamed production HTML with generated Vite assets',
    'traverses admin QR and songs with a preserved shell, reset page state and focus',
    'keeps the approved page and head while a later HTTP destination is pending',
    'removes an approved page stylesheet without removing the global stylesheet',
    'ignores a superseded approval without replacing the newer route or head',
    'resets an approved render failure without reloading the document or the shell resource',
    'shows a separate usable view if the application error view throws',
    'applies pathname, query, fragment and traversal focus and scroll defaults',
    'preserves page-local state when a fragment focuses a target inside the approved slot',
    'keeps the shell resource operational after a malformed fragment',
    'keeps the official page slot and navigation controls reachable at mobile width',
    'keeps native new tabs and full-document fallback on server rejection',
    'submits the native mutation form without client JavaScript'
  ],
  "ssr-delivery.spec.ts": [
    'built Fastify product route sends a socket shell before the gated descendant'
  ],
  "progressive-forms.spec.ts": [
    'real HTTP JSON compatibility records native submission classification',
    'native production CRUD with disabled',
    'native production CRUD with bootstrap-blocked',
    'enhanced production save keeps unrelated input and recovers a failed read without POST replay',
    'cookie authorization and CSRF reject enhanced mutations without save acknowledgement',
    'actual listener barrier skips click Enter and requestSubmit while another form validates',
    'real transport failure before-drop never repeats a POST',
    'real transport failure before503 never repeats a POST',
    'real transport failure drop-after never repeats a POST',
    'real transport failure after500 never repeats a POST',
    'real transport failure bad-media never repeats a POST',
    'real transport failure bad-schema never repeats a POST',
    'real transport failure bad-version never repeats a POST',
    'real transport failure unsafe never repeats a POST',
    'real transport failure redirect303 never repeats a POST',
    'real transport failure redirect307 never repeats a POST',
    'late response body and cancelled commit cannot overwrite an explicit later save',
    'confirmed save survives incompatible follow-up and GET-only recovery',
    'confirmed save survives import follow-up and GET-only recovery',
    'listener records native and negotiated DTO pipeline identity and actual successful controls',
    'native and enhanced listeners enforce missing expired and tampered credentials identically',
    'unsupported get activation remains exactly native',
    'unsupported multipart activation remains exactly native',
    'unsupported image activation remains exactly native',
    'unsupported target activation remains exactly native',
    'unsupported external activation remains exactly native',
    'constraint-invalid and consumer-prevented submissions never reach the listener',
    'public prefetch and an older streamed read cannot replace fresh saved data or its resource',
    'a late committed acknowledgement cannot outlive cancel intent',
    'a late committed acknowledgement cannot outlive navigate intent',
    'a late committed acknowledgement cannot outlive scope intent',
    'explicit domain form rejection keeps HTTP status and editable input without persistence'
  ],
  "revalidation.spec.ts": [
    'revalidates external changes without replacing page history or the live shell',
    'retains the last value on a failed refresh and retries through fresh HTTP',
    'a second refresh supersedes a held older HTTP approval without losing the shell',
    'refresh during an unapproved back restores the approved page before failure and retry'
  ],
  "session-transition.spec.ts": [
    'legacy plain children leave through a real unauthorized document after revocation',
    'configured POST auth policy refresh performs one fresh GET and never replays POST',
    'configured GET auth refresh dispatches a fresh read then settles signed out',
    'revokes initial and soft protected pages, closes owned ports, and cancels held HTTP before release',
    '403 stays forbidden and a confirmed permissions save is separate from its rejected GET',
    'anonymous 401 keeps approval and external HttpOnly logout is applied only on a fresh credentialed 401'
  ],
  "long-session-cache.spec.ts": [
    'repeated public cache cycles preserve 32 entries single use and the 64 KiB entry ceiling',
    'four live prefetches admit no fifth queue and excess activation uses fresh HTTP'
  ],
  "long-session-ownership.spec.ts": [
    'a correctly framed incompatible build preserves the operational document and recovers by fresh approval',
    'obsolete import completion cannot replace fresh HTTP approval or initiate fallback',
    'obsolete policy completion cannot replace fresh HTTP approval or initiate fallback',
    'a superseded partial HTTP body and invalid payload cannot restore their obsolete authority',
    'saved plus failed follow-up is recovered by GET only without a second POST',
    'invalid current payload uses the native document boundary and explicit reload creates a new resource'
  ],
  "long-session.spec.ts": [
    'settles at least 1000 seeded jukebox actions in one operational document'
  ]
};
const packedCaseTitles = {
  ...commonCaseTitles,
  "product-authoring.spec.ts": [
    'authored third page: generated props and enhanced saved data -> real HTTP approval without manual wiring',
    'authored third page: disabled JavaScript -> typed native POST303GET roundtrip',
    'authored third page: interrupted HTTP approval -> no partial destination commit'
  ],
  "production-hydration.spec.ts": [
    'opens modified links as native documents without replacing the current page',
    'hydrates two DTO pages and preserves the shell during HTTP-approved navigation',
    'retains the approved page and metadata while an HTTP destination is pending',
    'resets a throwing approved page locally without a second request',
    'refreshes the same page without remounting the generated shell or adding history',
    'keeps native POST, 303 and GET usable without client JavaScript',
    'preserves a generated page on refresh error and retries a fresh approval',
    'preserves the generated shell resource across network and fresh retry',
    'preserves the generated shell resource across server-error and fresh retry',
    'a failed replace commits no unapproved URL or params and explicit document exit remains available',
    'failed back and forward recover the approved entry and remain traversable',
    'repeated transient failures keep one resource and a usable next retry',
    'does not preserve an HTTP 401 refusal in the generated starter',
    'does not preserve an HTTP 403 refusal in the generated starter',
    'does not preserve an HTTP 302 refusal in the generated starter',
    'does not preserve an HTTP 400 refusal in the generated starter',
    'updates a React component and CSS over the app WebSocket without losing eligible state',
    'retains the document and worker through server restart and failed-bootstrap correction',
    'keeps document navigation when JavaScript is disabled',
    'keeps modified links as native new-tab documents',
    'keeps native anchors usable before hydration',
    'falls back to a native document for an unsupported destination',
    'reloads a shared graph only after readiness and aligns SSR with the client',
    'rebuilds the installed dev process on watched env and Vite configuration saves',
    'retains the approved shell after a mapped page import fails until explicit document exit'
  ],
  "session-transition.spec.ts": [
    'packaged session forms revoke initial protected content and recover a distinct session',
    'native session login and logout retain POST 303 GET without JavaScript'
  ],
  "deployment-transition.spec.ts": [
    'keeps an A shell on B navigation and updates only after explicit document choice',
    'reports a real missing mapped asset and preserves the last approved page'
  ]
};
const developmentOnlyCases = [
  'updates a React component and CSS over the app WebSocket without losing eligible state',
  'retains the document and worker through server restart and failed-bootstrap correction',
  'reloads a shared graph only after readiness and aligns SSR with the client',
  'rebuilds the installed dev process on watched env and Vite configuration saves'
];
const productionOnlyCases = [
  'retains the approved shell after a mapped page import fails until explicit document exit'
];
const browserFiles = {
  "ordinary-browser": [
    'deployment-transition.spec.ts',
    'navigation-failure.spec.ts',
    'production-hydration.spec.ts',
    'ssr-delivery.spec.ts'
  ],
  "product-browser": [
    'product-acceptance.spec.ts'
  ],
  "fault-browser": [
    'background-interactions.spec.ts',
    'navigation-guard.spec.ts',
    'product-faults.spec.ts',
    'progressive-forms.spec.ts',
    'revalidation.spec.ts',
    'session-transition.spec.ts'
  ],
  "reliability-browser": [
    'background-interactions.spec.ts',
    'long-session-cache.spec.ts',
    'long-session-ownership.spec.ts',
    'long-session.spec.ts',
    'product-acceptance.spec.ts',
    'product-faults.spec.ts',
    'session-transition.spec.ts'
  ],
  "packed-dev": [
    'background-interactions.spec.ts',
    'navigation-guard.spec.ts',
    'product-acceptance.spec.ts',
    'product-authoring.spec.ts',
    'product-faults.spec.ts',
    'production-hydration.spec.ts',
    'session-transition.spec.ts'
  ],
  "packed-production": [
    'background-interactions.spec.ts',
    'navigation-guard.spec.ts',
    'product-acceptance.spec.ts',
    'product-authoring.spec.ts',
    'product-faults.spec.ts',
    'production-hydration.spec.ts',
    'session-transition.spec.ts'
  ],
  "packed-deployment": [
    'deployment-transition.spec.ts'
  ],
  "soak-browser": [
    'long-session-soak.spec.ts'
  ]
};

function requiredBrowserCases(surface) {
  if (!browserFiles[surface]) return [];
  const packed = surface.startsWith('packed-');
  const titles = surface === 'soak-browser'
    ? { 'long-session-soak.spec.ts': ['operates the seeded event-driven jukebox for the declared soak duration'] }
    : packed ? packedCaseTitles : exampleCaseTitles;
  const projects = surface === 'reliability-browser' ? engines
    : surface === 'soak-browser' ? ['chromium'] : packed ? ['chrome'] : [''];
  return browserFiles[surface].flatMap((file) => titles[file]
    .filter((title) => !(surface === 'packed-dev' && productionOnlyCases.includes(title))
      && !(surface === 'packed-production' && developmentOnlyCases.includes(title)))
    .flatMap((title) => projects.map((project) => JSON.stringify([file, title, project]))));
}


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
        browserReport(JSON.parse(readFileSync(reportPath)), browserFiles[command.id], command.id);
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
          browserReport(JSON.parse(readFileSync(entry.browserReport)), browserFiles[id], id);
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

export function browserReport(value, requiredFiles = [], surface) {
  let tests = 0;
  const files = new Set();
  const cases = new Set();
  const requiredCases = requiredBrowserCases(surface);
  const visit = (suite) => {
    if (typeof suite.file === 'string') files.add(suite.file);
    for (const spec of suite.specs ?? []) {
      if (typeof spec.file === 'string') files.add(spec.file);
      for (const test of spec.tests ?? []) {
        const file = spec.file ?? suite.file;
        const identity = JSON.stringify([file?.split('/').at(-1), spec.title, test.projectName]);
        requireValue(!cases.has(identity), `Duplicate browser case/project: ${identity}`);
        cases.add(identity);
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
  requireValue(requiredCases.every((identity) => cases.has(identity)),
    `Missing mandatory browser case/project inventory: ${surface}`);
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
        const source = JSON.parse(file.bytes);
        requireValue(source.profile === run.profile && source.mode === run.mode
          && source.framework === run.framework && source.runId === run.runId,
        'Original source trace identity mismatch');
        requireValue((source.qualityFailures ?? []).length === 0
          && (source.correctness === 'pass' || source.correctness?.pass === true
            && Array.isArray(source.correctness.steps)
            && source.correctness.steps.every((step) => step.pass === true)),
        'Original source trace quality/correctness failure or inconclusive');
        return source;
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
  requireValue(soak?.kind === 'soak' && soak.engine === 'chromium' && soak.elapsedMs >= 3600000,
    'Fresh one-hour Chromium terminal soak required');
}

export function externalEvidence(root, receipt, head) {
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
  requireValue(['Verify', 'Primary build / build', 'Verify task (tooling-1) / tooling-1',
    'Verify task (starters) / starters'].every((name) =>
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
    const requiredFiles = browserFiles[check.id];
    requireValue(requiredFiles === undefined || check.browserReport, `Missing actual browser report: ${check.id}`);
    if (check.browserReport) browserReport(JSON.parse(artifact(root, check.browserReport).bytes), requiredFiles, check.id);
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
