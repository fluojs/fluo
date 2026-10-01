import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.FLUO_BACKGROUND_EVIDENCE;
if (!output || !resolve(output).startsWith(`${repo}/`)) throw new TypeError('Evidence must stay in this worktree.');
const attempt = randomUUID();
const target = { projectName: 'starter-react-vite-ssr', starter: 'react-vite-ssr' };
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const commands = [];
const reliability = process.env.FLUO_RELIABILITY_STARTER === '1';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
if (reliability && execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() !== '') {
  throw new Error('Packaged reliability requires a clean committed source head');
}
const reliabilityEnv = reliability ? { FLUO_REACT_RELIABILITY: '1', FLUO_RELIABILITY_STARTER: '1',
  FLUO_RELIABILITY_REPO: repo } : {};
async function run(label, args, cwd, env = {}, executable = 'pnpm') {
  console.log(`COMMAND ${label}: ${JSON.stringify({ command: [executable, ...args], cwd, env })}`);
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const started = performance.now();
  const chunks = [];
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    chunks.push(chunk); process.stdout.write(chunk);
  });
  const exit = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', done); });
  const log = join(output, `${label}-${attempt}.log`);
  writeFileSync(log, Buffer.concat(chunks));
  commands.push({ label, command: [executable, ...args], cwd, env, exit, elapsedMs: performance.now() - started, log });
  if (exit !== 0) throw new Error(`${label} exited ${exit}; complete raw log: ${log}`);
}
const directory = join(tmpdir(), `fluo-issue-3881-${attempt}`);
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
    return { name, path, sha256: sha(path), bytes: statSync(path).size };
  });
if (!tarballs.some((item) => item.name === '@fluojs/react')) throw new Error('React must be installed from a release tarball.');
const installedRoot = realpathSync(join(directory, 'node_modules/@fluojs/react'));
const installedFiles = ['client.js', 'client.d.ts', 'client/form.js', 'client/form.d.ts',
  'client/form-store.js', 'client/form-transport.js', 'client/store.js'].map((file) => {
  const installed = join(installedRoot, 'dist', file);
  const built = join(repo, 'packages/react/dist', file);
  if (sha(installed) !== sha(built)) throw new Error(`Installed release bytes do not match this build: ${file}`);
  return { file, installed, sha256: sha(installed) };
});
const installedTemplates = ['src/catalog.ts', 'src/page-products.tsx', 'tests/background-interactions.spec.ts',
  'tests/form-control.ts', ...(reliability ? ['src/page-admin.tsx', 'tests/import-control.ts',
    'tests/reliability-control.ts', 'tests/long-session.spec.ts', 'tests/long-session-run.ts',
    'tests/long-session-observer.ts', 'tests/long-session-helpers.ts', 'tests/long-session-metrics.ts'] : [])].map((file) => {
  const generated = join(directory, file);
  const template = join(repo, 'packages/cli/src/new/templates/react-vite-ssr', `${file}.ejs`);
  if (sha(generated) !== sha(template)) throw new Error(`Generated source differs from the packed authored template: ${file}`);
  return { file, generated, sha256: sha(generated) };
});
const lockedGraph = {
  snapshotSha256: sha(join(repo, 'tooling/cli/verification-locks/starter-react-vite-ssr.json')),
  installedLockfileSha256: sha(join(directory, 'pnpm-lock.yaml')),
};
const receipt = { head, status: 'incomplete', attempt, target, directory, lockedGraph, tarballs,
  installedFiles, installedTemplates, commands };
writeFileSync(join(output, `pack-release-${attempt}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
try {
  await run('starter-typegen', ['typegen'], directory);
  await run('starter-types', ['typecheck'], directory);
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
} finally {
  writeFileSync(join(output, `pack-release-${attempt}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(`PACKAGED_BACKGROUND_PASS ${JSON.stringify({ directory, attempt })}`);
