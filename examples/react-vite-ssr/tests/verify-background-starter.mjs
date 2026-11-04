import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { claimEvidenceRoot, createCommandEvidence } from '../../../tooling/ci/command-evidence.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.FLUO_BACKGROUND_EVIDENCE;
const ciEvidence = process.env.FLUO_PRODUCT_ACCEPTANCE === '1' && process.env.FLUO_PRODUCT_CI === '1'
  && output && resolve(output).startsWith('/evidence/react-product/');
const attempt = randomUUID();
const target = { projectName: 'starter-react-vite-ssr', starter: 'react-vite-ssr' };
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const commands = [];
const reliability = process.env.FLUO_RELIABILITY_STARTER === '1';
const product = process.env.FLUO_PRODUCT_ACCEPTANCE === '1';
export const authoringRejections = {
  'missing-module': /^.*\/src\/app\.ts:\d+:\d+: Browser module \.\/absent-page\.tsx is not in the frozen tsconfig graph; use its build-mapped module literal\.$/mu,
  'duplicate-route': /^Duplicate route registration detected for GET:\/products\/third:<none>\.$/mu,
  'invalid-route': /^@GET\(\) path "\/third\/:" is invalid at segment ":": Parameter names must match \/\[a-zA-Z_\]\[a-zA-Z0-9_\]\*\/\. Only literal segments and full-segment ":param" placeholders are supported\.$/mu,
  'negative-types': /^src\/acceptance-negative\.ts\(12,17\): error TS2345:/mu,
};
const reliabilityEnv = reliability ? { FLUO_REACT_RELIABILITY: '1', FLUO_RELIABILITY_STARTER: '1',
  FLUO_RELIABILITY_REPO: repo } : {};
// Only this factory creates the groups it signals. Ownership ends at close,
// not exit: inherited grandchild pipes can outlive the group leader.
export function spawnOwnedCommand(executable, args, options, graceMs = 2_000) {
  if (process.platform === 'win32') {
    throw new Error('Product command descendant ownership requires POSIX process groups; Windows is not supported.');
  }
  const owner = randomUUID();
  const parentOwner = process.env.FLUO_PRODUCT_COMMAND_OWNER;
  const announce = (action, pid) => {
    if (parentOwner && process.connected) process.send({ owner: parentOwner, action, pid });
  };
  const child = spawn(executable, args, { ...options, detached: true,
    env: { ...options.env, FLUO_PRODUCT_COMMAND_OWNER: owner },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const groups = new Set(child.pid ? [child.pid] : []);
  if (child.pid) announce('register', child.pid);
  const owned = { child, forced: false, stop };
  let stopping = false;
  let closed = false;
  let escalation;
  const signalGroup = (signal) => {
    let signalled = false;
    for (const pid of groups) {
      try {
        process.kill(-pid, signal);
        signalled = true;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    return signalled;
  };
  function stop() {
    if (closed || stopping) return;
    stopping = true;
    if (!signalGroup('SIGTERM')) return;
    escalation = setTimeout(() => {
      owned.forced = signalGroup('SIGKILL');
    }, graceMs);
  }
  // Nested runners transfer their separately created groups through this
  // child's private IPC channel. The ancestor retains them if the runner dies.
  child.on('message', (message) => {
    if (message?.owner !== owner || !Number.isSafeInteger(message.pid) || message.pid <= 0
      || message.pid === process.pid || closed) return;
    if (message.action === 'register') {
      groups.add(message.pid);
      announce('register', message.pid);
      child.emit('owned-descendant', message.pid);
      if (stopping) signalGroup(owned.forced ? 'SIGKILL' : 'SIGTERM');
    } else if (message.action === 'release') {
      groups.delete(message.pid);
      announce('release', message.pid);
    }
  });
  child.once('exit', stop);
  child.once('close', () => {
    // A final owned-group sweep also covers descendants without inherited pipes.
    signalGroup('SIGKILL');
    closed = true;
    clearTimeout(escalation);
    for (const pid of groups) announce('release', pid);
    groups.clear();
  });
  return owned;
}
export function createCommandRunner(output, commands, attempt = randomUUID()) {
const evidenceRoot = claimEvidenceRoot(output);
let cancelled = null;
const activeChildren = new Set();
const terminate = (signal) => {
  cancelled ??= signal;
  for (const owned of activeChildren) owned.stop();
};
const onTerm = () => terminate('SIGTERM');
const onInt = () => terminate('SIGINT');
process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
async function run(label, args, cwd, env = {}, executable = 'pnpm', expectedRejection = false, expectedExit = 1) {
  if (cancelled) throw new Error(`${label} cancelled by ${cancelled}; no command started.`);
  const capture = createCommandEvidence(evidenceRoot, `${label}-${attempt}`, { executable, args, env }, { cwd });
  let owned;
  try {
    owned = spawnOwnedCommand(executable, args, {
      cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    capture.finish({ exitCode: null, signal: null, closed: false, error });
    throw error;
  }
  const { child } = owned;
  activeChildren.add(owned);
  const started = performance.now();
  capture.attach(child);
  let outcome;
  let commandError;
  const onError = (error) => {
    commandError ??= error;
    owned.stop();
  };
  try {
    outcome = await new Promise((done) => {
      child.on('error', onError); child.once('close', (exit, signal) => done({ exit, signal }));
    });
  } finally {
    child.off('error', onError);
    activeChildren.delete(owned);
  }
  const { exit, signal } = outcome;
  if (signal !== null || exit === null) cancelled ??= signal ?? 'unknown termination';
  if (owned.forced) cancelled ??= 'forced descendant termination';
  const evidence = capture.finish({ exitCode: exit, signal, closed: true, cancelled: cancelled !== null, forced: owned.forced, error: commandError });
  const log = evidence.log.path;
  const diagnostics = readFileSync(log, 'utf8');
  commands.push({ label, command: [executable, ...args], cwd, env, exit,
    signal, close: true, evidence, expectedRejection: Boolean(expectedRejection), elapsedMs: performance.now() - started, log, logSha256: sha(log),
    ...(env.PLAYWRIGHT_JSON_OUTPUT_NAME && exit === 0 ? {
      browserReport: env.PLAYWRIGHT_JSON_OUTPUT_NAME, browserReportSha256: sha(env.PLAYWRIGHT_JSON_OUTPUT_NAME),
      browserReportBytes: statSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME).size,
    } : {}) });
  if (commandError) throw commandError;
  if (cancelled || signal !== null || exit === null
    || (expectedRejection ? exit !== expectedExit || !expectedRejection.test(diagnostics) : exit !== 0)) {
    throw new Error(`${label} unexpected exit ${exit}, signal ${signal}, cancellation ${cancelled}; complete raw log: ${log}`);
  }
  return diagnostics;
}
async function withProductionServer(cwd, binding, consume) {
  if (cancelled) throw new Error(`Production startup cancelled by ${cancelled}; no command started.`);
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  if (manifest.scripts?.start !== 'node dist/server/main.js') {
    throw new Error('Packed production requires the installed direct Node start script.');
  }
  const executable = process.execPath;
  const args = ['dist/server/main.js'];
  const env = { PORT: '0', FLUO_REACT_TEST_READY: '1', FLUO_REACT_FORM_TEST_SERVER: '1' };
  const capture = createCommandEvidence(evidenceRoot, `packed-production-server-${attempt}`,
    { executable, args, env }, { cwd });
  Object.assign(binding, { command: [executable, ...args], cwd, env, active: true,
    close: false, stopRequested: false });
  let resolveReady;
  let rejectReady;
  let resolveClosed;
  const ready = new Promise((done, reject) => { resolveReady = done; rejectReady = reject; });
  const closed = new Promise((done) => { resolveClosed = done; });
  void ready.catch(() => {});
  let owned;
  let pending = '';
  let failure;
  let commandError;
  let timeout;
  let stopping = false;
  let result;
  const fail = (error) => {
    failure ??= error;
    rejectReady(error);
    terminate('owned production server failure');
    owned?.stop();
  };
  const onError = (error) => {
    commandError ??= error;
    fail(error);
  };
  const onStdout = (chunk) => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('FLUO_REACT_READY ')) continue;
      const value = line.slice('FLUO_REACT_READY '.length);
      if (binding.ready || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(value)) {
        fail(new Error('Invalid or duplicate owned production readiness.'));
        return;
      }
      const port = Number(value.slice('http://127.0.0.1:'.length));
      if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
        fail(new Error('Owned production readiness requires a nonzero loopback origin.'));
        return;
      }
      const url = new URL(value);
      if (url.origin !== value) {
        fail(new Error('Owned production readiness requires a nonzero loopback origin.'));
        return;
      }
      binding.ready = { url: value, pid: owned.child.pid };
      clearTimeout(timeout);
      resolveReady(value);
    }
  };
  const onClose = (exit, signal) => {
    clearTimeout(timeout);
    if (!stopping) fail(new Error('Owned production server closed before requested cleanup.'));
    resolveClosed({ exit, signal });
  };
  try {
    owned = spawnOwnedCommand(executable, args, { cwd, env: { ...process.env, ...env } });
  } catch (error) {
    binding.active = false;
    binding.evidence = capture.finish({ exitCode: null, signal: null, closed: false, error });
    throw error;
  }
  const { child } = owned;
  binding.pid = child.pid;
  activeChildren.add(owned);
  child.once('error', onError);
  child.once('close', onClose);
  child.stdout.on('data', onStdout);
  capture.attach(child);
  timeout = setTimeout(() => fail(new Error('Owned production readiness exceeded 30000ms.')), 30_000);
  try {
    const url = await ready;
    if (cancelled || failure) throw failure ?? new Error(`Production cancelled by ${cancelled}.`);
    const path = join(cwd, `.fluo-packed-production-${attempt}.config.mjs`);
    const bytes = `import config from './playwright.config.ts';\n`
      + `export default { ...config, metadata: { ...config.metadata, ownedProductionURL: ${JSON.stringify(url)} }, webServer: undefined, use: { ...config.use, baseURL: ${JSON.stringify(url)} } };\n`;
    writeFileSync(path, bytes, { flag: 'wx' });
    const artifact = join(evidenceRoot.root, `packed-production-config-${attempt}.mjs`);
    copyFileSync(path, artifact);
    binding.config = { path, artifact, sha256: sha(path) };
    result = await consume({ url, config: path });
  } catch (error) {
    failure ??= error;
  } finally {
    stopping = true;
    binding.stopRequested = true;
    owned.stop();
    const { exit, signal } = await closed;
    child.off('error', onError);
    child.stdout.off('data', onStdout);
    activeChildren.delete(owned);
    clearTimeout(timeout);
    const evidence = capture.finish({ exitCode: exit, signal, closed: true,
      cancelled: cancelled !== null, forced: owned.forced, error: commandError });
    Object.assign(binding, { active: false, close: true, exit, signal,
      cancelled: cancelled !== null, forced: owned.forced, evidence,
      log: evidence.log.path, logSha256: evidence.log.sha256 });
    if (binding.config && sha(binding.config.path) !== binding.config.sha256) {
      failure ??= new Error('Actual packed production config changed during execution.');
    }
    if (cancelled || owned.forced || commandError
      || !(exit === 0 && signal === null || exit === null && signal === 'SIGTERM')) {
      failure ??= new Error(`Owned production cleanup failed: exit ${exit}, signal ${signal}, cancellation ${cancelled}.`);
    }
  }
  if (failure) throw failure;
  return result;
}
return { run, withProductionServer, dispose() {
  process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
} };
}

async function main() {
if (!output || !resolve(output).startsWith(`${repo}/`) && !ciEvidence) {
  throw new TypeError('Evidence must stay in this worktree or the canonical CI product evidence mount.');
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
if ((reliability || product) && execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() !== '') {
  throw new Error('Packaged reliability requires a clean committed source head');
}
const { run, withProductionServer, dispose } = createCommandRunner(output, commands, attempt);
try {
const directory = join(tmpdir(), `fluo-issue-${product ? '3879' : '3881'}-${attempt}`);
await run('starter-provision', ['packages/cli/scripts/local-test-env.mjs', 'create', target.projectName], repo, {
  FLUO_CLI_SANDBOX_ROOT: directory, FLUO_CLI_SANDBOX_STARTER: target.starter,
  FLUO_CLI_SANDBOX_DEPENDENCIES: 'locked', FLUO_CLI_SANDBOX_PROFILE: 'smoke',
}, process.execPath);
console.log(`SANDBOX ${directory}`);
const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const tarballs = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
  .filter(([name, spec]) => name.startsWith('@fluojs/') && typeof spec === 'string' && spec.startsWith('file:'))
  .map(([name, spec]) => {
    const path = resolve(directory, spec.slice('file:'.length));
    if (!statSync(path).isFile() || statSync(path).size === 0) throw new Error(`Missing release pack: ${name}`);
    const artifact = join(output, `${name.replaceAll('/', '-')}-${attempt}.tgz`);
    copyFileSync(path, artifact);
    return { name, path, artifact, sha256: sha(path), bytes: statSync(path).size };
  });
if (!tarballs.some((item) => item.name === '@fluojs/react')) throw new Error('React must be installed from a release tarball.');
const installedRoot = realpathSync(join(directory, 'node_modules/@fluojs/react'));
const installedFiles = ['client.js', 'client.d.ts', 'client/form.js', 'client/form.d.ts',
  'client/form-store.js', 'client/form-transport.js', 'client/store.js'].map((file) => {
  const installed = join(installedRoot, 'dist', file);
  const built = join(repo, 'packages/react/dist', file);
  if (sha(installed) !== sha(built)) throw new Error(`Installed release bytes do not match this build: ${file}`);
  const artifact = join(output, `installed-${file.replaceAll('/', '-')}-${attempt}`);
  copyFileSync(installed, artifact);
  return { file, installed, artifact, sha256: sha(installed) };
});
const installedTemplates = ['src/catalog.ts', 'src/page-products.tsx', 'tests/background-interactions.spec.ts',
  'tests/form-control.ts', ...(product ? ['tests/product-acceptance.spec.ts', 'tests/product-faults.spec.ts',
    'tests/product-authoring.spec.ts', 'src/app.ts', 'src/react-app.tsx', 'src/session-controls.tsx',
    'src/page-admin.tsx'] : []), ...(reliability ? ['src/page-admin.tsx', 'src/import-control.ts',
    'tests/reliability-control.ts', 'tests/long-session.spec.ts', 'tests/long-session-run.ts',
    'tests/long-session-observer.ts', 'tests/long-session-helpers.ts', 'tests/long-session-metrics.ts'] : [])].map((file) => {
  const generated = join(directory, file);
  const template = join(repo, 'packages/cli/src/new/templates/react-vite-ssr', `${file}.ejs`);
  if (sha(generated) !== sha(template)) throw new Error(`Generated source differs from the packed authored template: ${file}`);
  const artifact = join(output, `template-${file.replaceAll('/', '-')}-${attempt}`);
  copyFileSync(generated, artifact);
  return { file, generated, artifact, sha256: sha(generated) };
});
const lockedGraph = {
  snapshotSha256: sha(join(repo, 'tooling/cli/verification-locks/starter-react-vite-ssr.json')),
  installedLockfileSha256: sha(join(directory, 'pnpm-lock.yaml')),
};
const receipt = { head, source: { head, clean: product || reliability,
  tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim() },
  status: 'incomplete', attempt, product, target, directory, lockedGraph, tarballs,
  installedFiles, installedTemplates, commands };
writeFileSync(join(output, `pack-release-${attempt}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
try {
  if (product) {
    if (existsSync(join(directory, 'dist/server/main.js'))) throw new Error('Cold dev cannot borrow application dist.');
    const authoredPage = `import { Link, useForm } from '@fluojs/react/client';
import { reactFormRoutes, reactPageRoutes } from './generated/react-pages';
export type AcceptancePageProps = { readonly label: string; readonly savedName?: string };
export default function AcceptancePage({ label, savedName }: AcceptancePageProps) {
  const route = reactFormRoutes['POST /products/third/save ProductPageRouter thirdSave'];
  const form = useForm({ id: 'third-page-save', action: route.href(), contract: route.contract,
    allowDestination: (destination: string) => new URL(destination).pathname === '/products/third' });
  const saved = form.state.mutation?.status === 'saved' ? form.state.mutation.data?.name : savedName;
  return <section aria-label="Authored third page"><h1>{label}</h1>
    <form {...form.formProps} aria-label="Third page save" data-enhanced={String(form.connected)}>
      <label htmlFor="third-name">Third page name</label>
      <input {...form.fieldProps('name')} id="third-name" defaultValue={savedName ?? ''} minLength={3} required />
      <button type="submit">Save third page</button>
    </form><output data-third-saved>{saved}</output>
    <Link {...reactPageRoutes['GET /products/third ProductPageRouter third'].link({ label: 'Delayed' })}>Delayed third page</Link>
    <Link {...reactPageRoutes['GET /products/:sku ProductPageRouter show'].link({ sku: 'sku-42' })}>Leave third page</Link></section>;
}
`;
    const authoredDto = `class ThirdPageRead {
  @FromQuery('label')
  @IsString()
  @MinLength(3)
  label = '';
}
class ThirdPageWrite {
  @FromBody('name')
  @IsString()
  @MinLength(3)
  name = '';
}

`;
    const authoredHandlers = `
    @PageMetadata(({ request }) => ({ title: String(request.query.label ?? 'Third page') }))
    @Path('/third')
    @RequestDto(ThirdPageRead)
    async third(input: ThirdPageRead) {
      const props = { label: input.label, savedName: productNames.get('third') ?? '' };
      const page = options.loadPage ? await options.loadPage('./page-acceptance.tsx', props)
        : createElement((await import('./page-acceptance')).default, props);
      return ReactNavigationPage.create(page, { module: './page-acceptance.tsx', props });
    }
    @Post('/third/save')
    @RequestDto(ThirdPageWrite)
    thirdSave(input: ThirdPageWrite) {
      productNames.set('third', input.name);
      return ReactModule.formResult({ destination: '/products/third?label=Integrated%20third%20page',
        followUp: 'refresh', data: { name: input.name } });
    }
`;
    const appPath = join(directory, 'src/app.ts');
    const originalApp = readFileSync(appPath, 'utf8');
    const authoredApp = originalApp.replace('export function createAppModule', `${authoredDto}export function createAppModule`)
      .replace('  class ProductPageRouter {', `  class ProductPageRouter {${authoredHandlers}`);
    if (authoredApp === originalApp) throw new Error('Third-page authoring did not reach the actual HTTP controller.');
    writeFileSync(join(directory, 'src/page-acceptance.tsx'), authoredPage);
    writeFileSync(appPath, authoredApp);
    receipt.authoring = { authored: ['src/page-acceptance.tsx', 'src/app.ts'], optionalLinks: 'authored page only',
      manualWiring: [], generated: ['src/generated/react-pages.ts'], files: [
        { path: 'src/page-acceptance.tsx', sha256: sha(join(directory, 'src/page-acceptance.tsx')) },
        { path: 'src/app.ts', sha256: sha(appPath) },
      ], validationFiles: ['src/acceptance-negative.ts'],
      journeys: {
        authenticatedCrud: { authored: ['src/catalog.ts', 'src/page-products.tsx', 'src/app.ts'],
          reused: ['src/react-app.tsx', 'src/session-controls.tsx'], manualWiring: [],
          generated: ['src/generated/react-pages.ts'] },
        jukebox: { authored: [], reused: ['src/page-admin.tsx', 'src/catalog.ts',
          'src/react-app.tsx', 'src/session-controls.tsx'], manualWiring: [],
          generated: ['src/generated/react-pages.ts'] },
      } };
    for (const file of receipt.authoring.files) {
      file.artifact = join(output, `authored-${file.path.replaceAll('/', '-')}-${attempt}`);
      copyFileSync(join(directory, file.path), file.artifact);
      file.lines = readFileSync(file.artifact, 'utf8').split('\n').length;
    }
  }
  await run('starter-typegen', ['typegen'], directory);
  await run('starter-types', ['typecheck'], directory);
  if (product) {
    const appPath = join(directory, 'src/app.ts');
    const acceptedApp = readFileSync(appPath, 'utf8');
    const projection = join(directory, 'src/generated/react-pages.ts');
    const projectionDigest = sha(projection);
    const invalidCases = [
      ['missing-module', acceptedApp.replace("module: './page-acceptance.tsx'", "module: './absent-page.tsx'")],
      ['duplicate-route', acceptedApp.replace('  class ProductPageRouter {',
        "  class ProductPageRouter { @Path('/third') duplicateThird() { return null; }")],
      ['invalid-route', acceptedApp.replace("@Path('/third')", "@Path('/third/:')")],
    ];
    try {
      for (const [name, source] of invalidCases) {
        writeFileSync(appPath, source);
        await run(`authoring-${name}-rejection`, ['typegen'], directory, {}, 'pnpm', authoringRejections[name]);
        if (sha(projection) !== projectionDigest) throw new Error(`${name} published a partial projection.`);
      }
    } finally { writeFileSync(appPath, acceptedApp); }
    const negativePath = join(directory, 'src/acceptance-negative.ts');
    writeFileSync(negativePath, `import { useForm } from '@fluojs/react/client';
import { reactPageRoutes, reactFormRoutes, type ReactPagePropsByModule } from './generated/react-pages';
reactPageRoutes['GET /products/third ProductPageRouter third'].href({ label: 42 });
reactPageRoutes['GET /products/:sku ProductPageRouter show'].href({ sku: 42 });
reactPageRoutes['GET /private InternalRouter serverOnly'].href();
const props: ReactPagePropsByModule['./page-acceptance.tsx'] = { label: 42 };
const serverOnlyProps: ReactPagePropsByModule['./page-acceptance.tsx'] = { label: new Map() };
const route = reactFormRoutes['POST /products/third/save ProductPageRouter thirdSave'];
const saved: ReturnType<typeof route.contract.decodeSaved> = { name: 42 };
const form = useForm({ id: 'negative', action: route.href(), contract: route.contract,
  allowDestination: (destination: string) => new URL(destination).pathname === '/products/third' });
form.fieldProps('unknown');
void props; void saved; void serverOnlyProps;
`);
    try {
      const diagnostics = await run('authoring-negative-types', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'],
        directory, {}, 'pnpm', authoringRejections['negative-types'], 2);
      const errors = diagnostics.split('\n').filter((line) => /error TS\d+/u.test(line));
      const positions = errors.map((line) => {
        const match = /acceptance-negative\.ts\((\d+),(\d+)\): error TS(\d+):/u.exec(line);
        return match && { line: Number(match[1]), column: Number(match[2]), code: Number(match[3]) };
      });
      const rejectedLines = new Set(positions.map((position) => position?.line));
      if (![3, 4, 5, 6, 7, 9, 12].every((line) => rejectedLines.has(line))
        || ![[3, 2322], [4, 2322], [5, 7053], [6, 2322], [7, 2322], [9, 2322]]
          .every(([line, code]) => positions.some((position) => position?.line === line && position.code === code))
        || !positions.some((position) => position?.line === 12 && position.column === 17 && position.code === 2345)
        || positions.some((position) => position?.line === 10 || position?.line === 11)
        || errors.some((line) => !line.includes('acceptance-negative.ts'))) {
        throw new Error('Negative inference must reject each authored path/query/route/props/server-only/saved/input value.');
      }
    } finally {
      // The negative consumer is a generated runtime fixture, not a shipped source edit.
      const { unlinkSync } = await import('node:fs');
      unlinkSync(negativePath);
    }
    await run('authoring-positive-types', ['typegen'], directory);
    await run('authoring-positive-compile', ['typecheck'], directory);
    receipt.authoring.generatedSha256 = sha(projection);
    receipt.authoring.generatedArtifact = join(output, `authored-projection-${attempt}.ts`);
    copyFileSync(projection, receipt.authoring.generatedArtifact);
    const files = ['tests/production-hydration.spec.ts', 'tests/background-interactions.spec.ts',
      'tests/session-transition.spec.ts', 'tests/navigation-guard.spec.ts', 'tests/product-acceptance.spec.ts',
      'tests/product-faults.spec.ts', 'tests/product-authoring.spec.ts'];
    await run('packed-dev', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts', '--workers=1',
      '--reporter=json', `--output=${join(output, `packed-dev-${attempt}`)}`, ...files, '--grep-invert',
      'retains the approved shell after a mapped page import fails until explicit document exit'], directory, {
      FLUO_PRODUCT_ACCEPTANCE: '1', FLUO_REACT_STARTER_SERVER_COMMAND: 'dev',
      FLUO_REACT_STARTER_TEST_PORT: '44981', PLAYWRIGHT_JSON_OUTPUT_NAME: join(output, `packed-dev-${attempt}.json`),
    });
    if (existsSync(join(directory, 'dist/server/main.js'))) throw new Error('Development journey created application dist.');
    await run('starter-tests', ['test'], directory);
    await run('starter-build', ['build'], directory);
    receipt.productionServer = {};
    await withProductionServer(directory, receipt.productionServer, ({ url, config }) =>
      run('packed-production', ['exec', 'playwright', 'test', '--config', config, '--workers=1',
        '--reporter=json', `--output=${join(output, `packed-production-${attempt}`)}`, ...files, '--grep-invert',
        'updates a React component|retains the document and worker|reloads a shared graph|rebuilds the installed dev process'],
      directory, { FLUO_PRODUCT_ACCEPTANCE: '1', FLUO_REACT_STARTER_TEST_PORT: new URL(url).port,
        FLUO_REACT_READY_URL: url,
        PLAYWRIGHT_JSON_OUTPUT_NAME: join(output, `packed-production-${attempt}.json`) }));
    await run('packed-deployment', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts', '--workers=1',
      '--reporter=json', `--output=${join(output, `packed-deployment-${attempt}`)}`, 'tests/deployment-transition.spec.ts'],
    directory, { FLUO_PRODUCT_ACCEPTANCE: '1', FLUO_REACT_STARTER_TEST_PORT: '44983',
      PLAYWRIGHT_JSON_OUTPUT_NAME: join(output, `packed-deployment-${attempt}.json`) });
    if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() !== head) {
      throw new Error('Source head changed during packaged product verification.');
    }
    receipt.status = 'passed';
  } else {
  await run('starter-tests', ['test'], directory);
  await run('starter-build', ['build'], directory, { FLUO_REACT_FORM_TEST_SERVER: '1', ...reliabilityEnv });
  if (reliability) await run('starter-browser-provision',
    ['exec', 'playwright', 'install', '--with-deps', 'chromium', 'firefox', 'webkit'], directory);
  const focusedBrowserFiles = reliability ? ['tests/long-session.spec.ts'] : ['tests/background-interactions.spec.ts', 'tests/session-transition.spec.ts',
    'tests/production-hydration.spec.ts', '--grep-invert',
    'updates a React component|retains the document and worker|reloads a shared graph|rebuilds the installed dev process'];
  const browserRuns = [
    () => run('starter-dev-browser', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts', reliability ? '--workers=1' : '--workers=12',
      `--output=${join(output, `starter-dev-browser-${attempt}`)}`, ...focusedBrowserFiles],
    directory, { FLUO_REACT_FORM_TEST_SERVER: '1', ...reliabilityEnv, FLUO_REACT_STARTER_SERVER_COMMAND: 'dev', FLUO_REACT_STARTER_TEST_PORT: '44981' }),
    () => run('starter-prod-browser', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts', reliability ? '--workers=1' : '--workers=12',
      `--output=${join(output, `starter-prod-browser-${attempt}`)}`, ...focusedBrowserFiles],
    directory, { FLUO_REACT_FORM_TEST_SERVER: '1', ...reliabilityEnv, FLUO_REACT_STARTER_TEST_PORT: '44982' }),
  ];
  if (reliability) for (const runBrowser of browserRuns) await runBrowser();
  else {
    const browserResults = await Promise.allSettled(browserRuns.map((runBrowser) => runBrowser()));
    for (const result of browserResults) if (result.status === 'rejected') throw result.reason;
  }
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() !== head) {
    throw new Error('Source head changed during packaged verification');
  }
  receipt.status = 'passed';
  }
} finally {
  writeFileSync(join(output, `pack-release-${attempt}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(`PACKAGED_BACKGROUND_PASS ${JSON.stringify({ directory, attempt })}`);
} finally { dispose(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
