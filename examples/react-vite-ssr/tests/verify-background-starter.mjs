import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.FLUO_BACKGROUND_EVIDENCE;
const ciEvidence = process.env.FLUO_PRODUCT_ACCEPTANCE === '1' && process.env.FLUO_PRODUCT_CI === '1'
  && output && resolve(output).startsWith('/evidence/react-product/');
if (!output || !resolve(output).startsWith(`${repo}/`) && !ciEvidence) {
  throw new TypeError('Evidence must stay in this worktree or the canonical CI product evidence mount.');
}
const attempt = randomUUID();
const target = { projectName: 'starter-react-vite-ssr', starter: 'react-vite-ssr' };
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const commands = [];
const reliability = process.env.FLUO_RELIABILITY_STARTER === '1';
const product = process.env.FLUO_PRODUCT_ACCEPTANCE === '1';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
if ((reliability || product) && execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() !== '') {
  throw new Error('Packaged reliability requires a clean committed source head');
}
const reliabilityEnv = reliability ? { FLUO_REACT_RELIABILITY: '1', FLUO_RELIABILITY_STARTER: '1',
  FLUO_RELIABILITY_REPO: repo } : {};
async function run(label, args, cwd, env = {}, executable = 'pnpm', expectedRejection = false) {
  console.log(`COMMAND ${label}: ${JSON.stringify({ command: [executable, ...args], cwd, env })}`);
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const started = performance.now();
  const chunks = [];
  const log = join(output, `${label}-${attempt}.log`);
  const raw = createWriteStream(log);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    chunks.push(chunk); raw.write(chunk); process.stdout.write(chunk);
  });
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
  let outcome;
  try {
    outcome = await new Promise((done, fail) => {
      child.once('error', fail); child.once('close', (exit, signal) => done({ exit, signal }));
    });
  } finally {
    process.off('SIGTERM', terminate); process.off('SIGINT', terminate);
    raw.end(); await finished(raw);
  }
  const { exit, signal } = outcome;
  commands.push({ label, command: [executable, ...args], cwd, env, exit,
    signal, expectedRejection, elapsedMs: performance.now() - started, log, logSha256: sha(log),
    ...(env.PLAYWRIGHT_JSON_OUTPUT_NAME && exit === 0 ? {
      browserReport: env.PLAYWRIGHT_JSON_OUTPUT_NAME, browserReportSha256: sha(env.PLAYWRIGHT_JSON_OUTPUT_NAME),
    } : {}) });
  if (expectedRejection ? exit === 0 : exit !== 0) throw new Error(`${label} unexpected exit ${exit}; complete raw log: ${log}`);
  return Buffer.concat(chunks).toString();
}
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
        await run(`authoring-${name}-rejection`, ['typegen'], directory, {}, 'pnpm', true);
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
        directory, {}, 'pnpm', true);
      const errors = diagnostics.split('\n').filter((line) => /error TS\d+/u.test(line));
      const positions = errors.map((line) => {
        const match = /acceptance-negative\.ts\((\d+),(\d+)\): error TS(\d+):/u.exec(line);
        return match && { line: Number(match[1]), column: Number(match[2]), code: Number(match[3]) };
      });
      const rejectedLines = new Set(positions.map((position) => position?.line));
      if (![3, 4, 5, 6, 7, 9, 12].every((line) => rejectedLines.has(line))
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
    await run('packed-production', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts', '--workers=1',
      '--reporter=json', `--output=${join(output, `packed-production-${attempt}`)}`, ...files, '--grep-invert',
      'updates a React component|retains the document and worker|reloads a shared graph|rebuilds the installed dev process'],
    directory, { FLUO_PRODUCT_ACCEPTANCE: '1', FLUO_REACT_STARTER_TEST_PORT: '44982',
      PLAYWRIGHT_JSON_OUTPUT_NAME: join(output, `packed-production-${attempt}.json`) });
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
