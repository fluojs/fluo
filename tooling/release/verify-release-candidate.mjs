import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const summaryPath = join(scriptDirectory, 'release-candidate-summary.md');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`);
  }
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function assertCheck(checks, label, condition, detail) {
  checks.push({ detail, label, pass: condition });

  if (!condition) {
    throw new Error(`Release candidate check failed: ${label}. ${detail}`);
  }
}

function writeSummary(checks) {
  mkdirSync(scriptDirectory, { recursive: true });
  const summary = [
    '# release candidate summary',
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    '- Commands executed: `pnpm typecheck`, `pnpm build`, `pnpm test`',
  ].join('\n');

  writeFileSync(summaryPath, `${summary}\n`, 'utf8');
}

const checks = [];

run('pnpm', ['typecheck']);
run('pnpm', ['build']);
run('pnpm', ['test']);

const quickStart = read('docs/quick-start.md');
const releaseGovernance = read('docs/release-governance.md');
const toolchainContract = read('docs/toolchain-contract-matrix.md');
const presetGuide = read('docs/preset-guide.md');
const cliPrompt = read('packages/cli/src/new/prompt.ts');
const cliReadme = read('packages/cli/README.md');
const scaffoldSource = read('packages/cli/src/new/scaffold.ts');
const cliPackage = JSON.parse(read('packages/cli/package.json'));

assertCheck(
  checks,
  'Canonical bootstrap docs',
  quickStart.includes('pnpm dlx @konekti/cli new starter-app') && quickStart.includes('This is the canonical public bootstrap path.'),
  'The quick start guide documents the public `pnpm dlx @konekti/cli new` path.',
);
assertCheck(
  checks,
  'Repo-local smoke path docs',
  quickStart.includes('pnpm exec konekti new starter-app') && quickStart.includes('testing support only'),
  'The repo-local bootstrap path is documented as testing support only.',
);
assertCheck(
  checks,
  'Starter shape and runtime ownership',
  scaffoldSource.includes('runNodeApplication') &&
    scaffoldSource.includes('createHealthModule') &&
    scaffoldSource.includes('MetricsModule.forRoot') &&
    scaffoldSource.includes('OpenApiModule.forRoot') &&
    !scaffoldSource.includes('src/node-http-adapter.ts'),
  'The generated starter uses runtime-owned bootstrap helpers and includes health, metrics, and OpenAPI surfaces.',
);
assertCheck(
  checks,
  'Support-tier wording alignment',
  cliPrompt.includes('recommended') &&
    cliPrompt.includes('official') &&
    cliPrompt.includes('preview') &&
    presetGuide.includes('recommended') &&
    presetGuide.includes('official') &&
    presetGuide.includes('preview'),
  'Prompt code and public docs use the same recommended/official/preview tier language.',
);
assertCheck(
  checks,
  'Toolchain contract lock',
  !toolchainContract.includes('to be locked') &&
    toolchainContract.includes('public contract') &&
    toolchainContract.includes('generated (stable)') &&
    toolchainContract.includes('internal-only'),
  'The toolchain contract matrix is locked with public/generated/internal statuses.',
);
assertCheck(
  checks,
  'Manifest benchmark evidence',
  releaseGovernance.includes('manifest decision note') && existsSync(join(repoRoot, 'tooling/benchmarks/manifest-decision.latest.json')),
  'Release docs still point at the benchmark-backed manifest decision snapshot.',
);
assertCheck(
  checks,
  'Dist-based package entrypoints',
  cliPackage.bin.konekti === './bin/konekti.mjs' &&
    cliPackage.main === './dist/index.js' &&
    cliReadme.includes('canonical CLI'),
  'CLI manifest and bin prove a dist-backed public entrypoint.',
);

writeSummary(checks);
console.log(`Release candidate summary written to ${summaryPath}`);
