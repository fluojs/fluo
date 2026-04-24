#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const targetVersion = '1.0.0-beta.1';
const distTag = 'beta';
const ledgerPath = join(scriptDirectory, 'bootstrap-ledger.json');
const evidenceRoot = join(repoRoot, '.sisyphus/evidence/all-packages-npm-beta-publish');
const dryRunRoot = join(evidenceRoot, 'dry-run');
const publishRoot = join(evidenceRoot, 'publish');
const registryRoot = join(evidenceRoot, 'registry');
const resumeRoot = join(evidenceRoot, 'resume');
const globalGateRoot = join(evidenceRoot, 'global-gates');

const allowedStatuses = new Set([
  'pending',
  'dry-run-passed',
  'publish-started',
  'published',
  'verify-passed',
  'already-published',
  'failed',
]);
const immutableSuccessStatuses = new Set(['verify-passed', 'already-published']);

const lockedPackages = [
  { order: 1, wave: 'P1', name: '@fluojs/core', dir: 'packages/core' },
  { order: 2, wave: 'P2', name: '@fluojs/config', dir: 'packages/config' },
  { order: 3, wave: 'P2', name: '@fluojs/di', dir: 'packages/di' },
  { order: 4, wave: 'P2', name: '@fluojs/validation', dir: 'packages/validation' },
  { order: 5, wave: 'P3', name: '@fluojs/http', dir: 'packages/http' },
  { order: 6, wave: 'P4', name: '@fluojs/runtime', dir: 'packages/runtime' },
  { order: 7, wave: 'P4', name: '@fluojs/serialization', dir: 'packages/serialization' },
  { order: 8, wave: 'P5', name: '@fluojs/cli', dir: 'packages/cli' },
  { order: 9, wave: 'P5', name: '@fluojs/event-bus', dir: 'packages/event-bus' },
  { order: 10, wave: 'P5', name: '@fluojs/jwt', dir: 'packages/jwt' },
  { order: 11, wave: 'P5', name: '@fluojs/notifications', dir: 'packages/notifications' },
  { order: 12, wave: 'P5', name: '@fluojs/redis', dir: 'packages/redis' },
  { order: 13, wave: 'P5', name: '@fluojs/drizzle', dir: 'packages/drizzle' },
  { order: 14, wave: 'P5', name: '@fluojs/prisma', dir: 'packages/prisma' },
  { order: 15, wave: 'P5', name: '@fluojs/graphql', dir: 'packages/graphql' },
  { order: 16, wave: 'P5', name: '@fluojs/metrics', dir: 'packages/metrics' },
  { order: 17, wave: 'P5', name: '@fluojs/microservices', dir: 'packages/microservices' },
  { order: 18, wave: 'P5', name: '@fluojs/mongoose', dir: 'packages/mongoose' },
  { order: 19, wave: 'P5', name: '@fluojs/openapi', dir: 'packages/openapi' },
  { order: 20, wave: 'P5', name: '@fluojs/platform-bun', dir: 'packages/platform-bun' },
  { order: 21, wave: 'P5', name: '@fluojs/platform-cloudflare-workers', dir: 'packages/platform-cloudflare-workers' },
  { order: 22, wave: 'P5', name: '@fluojs/platform-deno', dir: 'packages/platform-deno' },
  { order: 23, wave: 'P5', name: '@fluojs/platform-express', dir: 'packages/platform-express' },
  { order: 24, wave: 'P5', name: '@fluojs/platform-fastify', dir: 'packages/platform-fastify' },
  { order: 25, wave: 'P5', name: '@fluojs/platform-nodejs', dir: 'packages/platform-nodejs' },
  { order: 26, wave: 'P5', name: '@fluojs/studio', dir: 'packages/studio' },
  { order: 27, wave: 'P6', name: '@fluojs/cache-manager', dir: 'packages/cache-manager' },
  { order: 28, wave: 'P6', name: '@fluojs/terminus', dir: 'packages/terminus' },
  { order: 29, wave: 'P6', name: '@fluojs/throttler', dir: 'packages/throttler' },
  { order: 30, wave: 'P6', name: '@fluojs/testing', dir: 'packages/testing' },
  { order: 31, wave: 'P6', name: '@fluojs/websockets', dir: 'packages/websockets' },
  { order: 32, wave: 'P7', name: '@fluojs/cqrs', dir: 'packages/cqrs' },
  { order: 33, wave: 'P7', name: '@fluojs/cron', dir: 'packages/cron' },
  { order: 34, wave: 'P7', name: '@fluojs/queue', dir: 'packages/queue' },
  { order: 35, wave: 'P7', name: '@fluojs/discord', dir: 'packages/discord' },
  { order: 36, wave: 'P7', name: '@fluojs/slack', dir: 'packages/slack' },
  { order: 37, wave: 'P7', name: '@fluojs/passport', dir: 'packages/passport' },
  { order: 38, wave: 'P8', name: '@fluojs/email', dir: 'packages/email' },
  { order: 39, wave: 'P8', name: '@fluojs/socket.io', dir: 'packages/socket.io' },
];

const globalGateCommands = [
  { command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  { command: 'pnpm', args: ['build'] },
  { command: 'pnpm', args: ['typecheck'] },
  { command: 'pnpm', args: ['lint'] },
  {
    command: 'pnpm',
    args: ['vitest', 'run', '--project', 'packages'],
    env: {
      FLUO_VITEST_SHUTDOWN_DEBUG: '1',
      FLUO_VITEST_SHUTDOWN_DEBUG_DIR:
        '.sisyphus/evidence/all-packages-npm-beta-publish/global-gates/vitest-shutdown-debug/packages',
    },
  },
  {
    command: 'pnpm',
    args: ['vitest', 'run', '--project', 'apps'],
    env: {
      FLUO_VITEST_SHUTDOWN_DEBUG: '1',
      FLUO_VITEST_SHUTDOWN_DEBUG_DIR:
        '.sisyphus/evidence/all-packages-npm-beta-publish/global-gates/vitest-shutdown-debug/apps',
    },
  },
  {
    command: 'pnpm',
    args: ['vitest', 'run', '--project', 'examples'],
    env: {
      FLUO_VITEST_SHUTDOWN_DEBUG: '1',
      FLUO_VITEST_SHUTDOWN_DEBUG_DIR:
        '.sisyphus/evidence/all-packages-npm-beta-publish/global-gates/vitest-shutdown-debug/examples',
    },
  },
  {
    command: 'pnpm',
    args: ['vitest', 'run', '--project', 'tooling'],
    env: {
      FLUO_VITEST_SHUTDOWN_DEBUG: '1',
      FLUO_VITEST_SHUTDOWN_DEBUG_DIR:
        '.sisyphus/evidence/all-packages-npm-beta-publish/global-gates/vitest-shutdown-debug/tooling',
    },
  },
  { command: 'pnpm', args: ['--dir', 'packages/cli', 'sandbox:matrix'] },
  { command: 'pnpm', args: ['verify:platform-consistency-governance'] },
  { command: 'pnpm', args: ['verify:release-readiness'] },
];

function usage() {
  return `Bootstrap publish runner for the one-time @fluojs/* npm beta train.

Target: ${targetVersion} with npm dist-tag "${distTag}".
Ledger: ${relative(repoRoot, ledgerPath)}

Commands:
  init [--force]
    Create a ${lockedPackages.length}-entry pending ledger in the frozen dependency-first order.

  preflight
    Run local metadata checks: 39 manifests, exact versions, package names, public access,
    changelog section, ledger shape if present, and print the required run-once global gate sequence.

  dry-run --all | --package <name>
    Sequentially run pnpm pack, inspect the tarball manifest/files, run pnpm publish --dry-run,
    write dry-run evidence, and mark packages dry-run-passed. Stops on first failure.

  publish --all | --package <name>
    Sequentially publish with: pnpm --dir <package.dir> publish --access public --tag beta --no-git-checks.
    Only dry-run-passed packages are upload-eligible. Never republishes verify-passed,
    already-published, published, or publish-started entries. OTP/auth failures stop with resume guidance.

  verify --all | --package <name>
    Query npm registry for version and dist-tags, write registry evidence, and mark verify-passed when
    ${targetVersion} exists and beta points at ${targetVersion}. This is the only next action for published
    or publish-started entries.

  resume-check
    Validate sequential ledger invariants and print the next safe command. Blocks on failed,
    publish-started, and published states until registry reconciliation is performed.

  summary
    Print package counts by status and the next safe action.

Status semantics:
  pending          No dry-run or publish attempt recorded.
  dry-run-passed   Pack/tarball validation and pnpm publish --dry-run passed; upload eligible.
  publish-started  Real upload began and outcome is ambiguous; verify registry before retry.
  published        Publish command exited 0; do not upload again, run verify next.
  verify-passed    Registry confirmed version and beta tag; immutable success.
  already-published Registry preflight/reconciliation confirmed version and beta tag; immutable success.
  failed           Non-ambiguous failure; fix root cause and reconcile registry before resuming.
`;
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAtomic(path, value) {
  ensureDirectory(dirname(path));
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env,
  });
}

function commandLine(command, args) {
  return [command, ...args].join(' ');
}

function slugFor(packageName) {
  return packageName
    .replace(/^@fluojs\//u, '')
    .replace(/[^a-z0-9-]/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function initialEntry(packageRecord) {
  return {
    ...packageRecord,
    version: targetVersion,
    distTag,
    status: 'pending',
    attemptCount: 0,
    timestamps: {
      dryRunPassedAt: null,
      publishStartedAt: null,
      publishedAt: null,
      verifiedAt: null,
      failedAt: null,
    },
    lastError: null,
    evidencePaths: {
      dryRunLog: null,
      publishLog: null,
      registryJson: null,
      resumeLog: null,
    },
  };
}

function createLedger() {
  const timestamp = now();
  return {
    schemaVersion: 1,
    targetVersion,
    distTag,
    createdAt: timestamp,
    updatedAt: timestamp,
    packages: lockedPackages.map(initialEntry),
  };
}

function loadLedger() {
  if (!existsSync(ledgerPath)) {
    throw new Error(`Ledger does not exist. Run: node ${relative(repoRoot, fileURLToPath(import.meta.url))} init`);
  }

  const ledger = readJson(ledgerPath);
  validateLedgerShape(ledger);
  return ledger;
}

function saveLedger(ledger) {
  ledger.updatedAt = now();
  writeJsonAtomic(ledgerPath, ledger);
}

function validateLedgerShape(ledger) {
  assert(ledger.schemaVersion === 1, 'ledger schemaVersion must be 1');
  assert(ledger.targetVersion === targetVersion, `ledger targetVersion must be ${targetVersion}`);
  assert(ledger.distTag === distTag, `ledger distTag must be ${distTag}`);
  assert(Array.isArray(ledger.packages), 'ledger packages must be an array');
  assert(ledger.packages.length === lockedPackages.length, `ledger must contain ${lockedPackages.length} packages`);

  for (const [index, expected] of lockedPackages.entries()) {
    const actual = ledger.packages[index];
    assert(actual.order === expected.order, `ledger entry ${index + 1} order mismatch`);
    assert(actual.wave === expected.wave, `ledger entry ${index + 1} wave mismatch`);
    assert(actual.name === expected.name, `ledger entry ${index + 1} name mismatch`);
    assert(actual.dir === expected.dir, `ledger entry ${index + 1} dir mismatch`);
    assert(actual.version === targetVersion, `${actual.name} ledger version must be ${targetVersion}`);
    assert(actual.distTag === distTag, `${actual.name} ledger distTag must be ${distTag}`);
    assert(allowedStatuses.has(actual.status), `${actual.name} has invalid status ${actual.status}`);
    assert(Number.isInteger(actual.attemptCount), `${actual.name} attemptCount must be an integer`);
    assert(actual.timestamps && typeof actual.timestamps === 'object', `${actual.name} timestamps missing`);
    assert(actual.evidencePaths && typeof actual.evidencePaths === 'object', `${actual.name} evidencePaths missing`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function manifestPath(entry) {
  return join(repoRoot, entry.dir, 'package.json');
}

function loadSourceManifest(entry) {
  return readJson(manifestPath(entry));
}

function validateSourceManifest(entry, manifest) {
  assert(manifest.name === entry.name, `${entry.dir}/package.json name must be ${entry.name}`);
  assert(manifest.version === targetVersion, `${entry.name} version must be ${targetVersion}`);
  assert(manifest.private === false, `${entry.name} must be private: false`);
  assert(manifest.publishConfig?.access === 'public', `${entry.name} must publish with public access`);
}

function collectLocalExportTargets(exportsField) {
  const targets = new Set();

  function visit(value) {
    if (typeof value === 'string') {
      if (value.startsWith('./')) {
        targets.add(value);
      }
      return;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  }

  visit(exportsField);
  return [...targets];
}

function packageTarPath(relativePathValue) {
  return `package/${relativePathValue.replace(/^\.\//u, '')}`;
}

function jsonContainsWorkspace(value) {
  if (typeof value === 'string') {
    return value.includes('workspace:');
  }
  if (Array.isArray(value)) {
    return value.some(jsonContainsWorkspace);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(jsonContainsWorkspace);
  }
  return false;
}

function validatePackedManifest(entry, sourceManifest, packedManifest, files, logLines) {
  const fileSet = new Set(files);
  const checks = [];
  const check = (label, condition, detail) => {
    checks.push({ label, pass: Boolean(condition), detail });
    if (!condition) {
      throw new Error(`${entry.name}: ${label}. ${detail}`);
    }
  };

  check('source manifest identity', sourceManifest.name === entry.name && sourceManifest.version === targetVersion, manifestPath(entry));
  check('source publish access', sourceManifest.private === false && sourceManifest.publishConfig?.access === 'public', manifestPath(entry));
  check('packed manifest identity', packedManifest.name === entry.name && packedManifest.version === targetVersion, 'packed package.json');
  check('packed manifest is public', packedManifest.private !== true, 'private true must not be packed');
  check('workspace protocol conversion', !jsonContainsWorkspace(packedManifest), 'packed manifest must not contain workspace:');
  check('package/package.json present', fileSet.has('package/package.json'), 'tarball file list');

  if (Array.isArray(sourceManifest.files) && sourceManifest.files.includes('dist')) {
    check('dist files present', files.some((file) => file.startsWith('package/dist/')), 'files includes dist');
  }

  if (typeof sourceManifest.main === 'string') {
    check('main file present', fileSet.has(packageTarPath(sourceManifest.main)), sourceManifest.main);
  }

  if (typeof sourceManifest.types === 'string') {
    check('types file present', fileSet.has(packageTarPath(sourceManifest.types)), sourceManifest.types);
  }

  for (const target of collectLocalExportTargets(sourceManifest.exports)) {
    if (target === './dist/index.html') {
      check('export target present', fileSet.has(packageTarPath(target)), target);
      continue;
    }

    check('export target present', fileSet.has(packageTarPath(target)), target);
  }

  if (entry.name === '@fluojs/cli') {
    check('CLI bin manifest', packedManifest.bin?.fluo === './bin/fluo.mjs', 'bin.fluo must be ./bin/fluo.mjs');
    check('CLI bin file', fileSet.has('package/bin/fluo.mjs'), 'package/bin/fluo.mjs');
    check(
      'CLI templates present',
      files.some((file) => file.startsWith('package/dist/generators/templates/') && !file.endsWith('/')),
      'dist/generators/templates must contain files',
    );
    logLines.push('CLI packaging: bin=package/bin/fluo.mjs; templates present under package/dist/generators/templates/.');
  }

  if (entry.name === '@fluojs/studio') {
    check('Studio viewer export', sourceManifest.exports?.['./viewer'] === './dist/index.html', 'exports[./viewer]');
    check('Studio viewer HTML', fileSet.has('package/dist/index.html'), 'package/dist/index.html');
    check('Studio contracts JS', fileSet.has('package/dist/contracts.js'), 'package/dist/contracts.js');
    check('Studio contracts declarations', fileSet.has('package/dist/contracts.d.ts'), 'package/dist/contracts.d.ts');
    logLines.push('Studio packaging: viewer=package/dist/index.html; contracts entrypoints present.');
  }

  return checks;
}

function tarList(tarballPath) {
  const result = run('tar', ['-tf', tarballPath]);
  if (result.status !== 0) {
    throw new Error(`tar -tf failed for ${tarballPath}: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function tarRead(tarballPath, file) {
  const result = run('tar', ['-xOf', tarballPath, file]);
  if (result.status !== 0) {
    throw new Error(`tar -xOf ${file} failed for ${tarballPath}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function newestTarball(directory, previousFiles) {
  const previous = new Set(previousFiles);
  const candidates = readdirSync(directory)
    .filter((file) => file.endsWith('.tgz') && !previous.has(file))
    .map((file) => ({ file, mtimeMs: statSync(join(directory, file)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`pnpm pack did not create a new tarball in ${directory}`);
  }

  return join(directory, candidates[0].file);
}

function ensureSequentialBefore(ledger, entry) {
  for (const prior of ledger.packages.slice(0, entry.order - 1)) {
    if (!immutableSuccessStatuses.has(prior.status)) {
      throw new Error(
        `${entry.name} cannot proceed because earlier package ${prior.name} is ${prior.status}. Resume in locked order only.`,
      );
    }
  }
}

function setFailure(entry, command, resultOrError, evidencePath) {
  entry.status = 'failed';
  entry.timestamps.failedAt = now();
  entry.lastError = {
    command,
    exitCode: typeof resultOrError?.status === 'number' ? resultOrError.status : 1,
    message: `${resultOrError?.message ?? ''}${resultOrError?.stderr ?? ''}${resultOrError?.stdout ?? ''}`.trim(),
    evidencePath: relative(repoRoot, evidencePath),
    occurredAt: now(),
  };
}

function selectedEntries(ledger, options) {
  if (options.all) {
    return ledger.packages;
  }

  if (options.packageName) {
    const entry = ledger.packages.find((candidate) => candidate.name === options.packageName);
    if (!entry) {
      throw new Error(`Unknown package: ${options.packageName}`);
    }
    return [entry];
  }

  throw new Error('Select packages with --all or --package <name>.');
}

function parseOptions(argv) {
  const options = { all: false, force: false, packageName: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') {
      options.all = true;
    } else if (argument === '--force') {
      options.force = true;
    } else if (argument === '--package') {
      options.packageName = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--package=')) {
      options.packageName = argument.slice('--package='.length);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.all && options.packageName) {
    throw new Error('Use either --all or --package, not both.');
  }

  return options;
}

function commandInit(options) {
  if (existsSync(ledgerPath) && !options.force) {
    throw new Error(`Ledger already exists at ${relative(repoRoot, ledgerPath)}. Use init --force to recreate it.`);
  }

  const ledger = createLedger();
  writeJsonAtomic(ledgerPath, ledger);
  console.log(`Initialized ${ledger.packages.length}-entry ledger at ${relative(repoRoot, ledgerPath)}.`);
  console.log(`First: ${ledger.packages[0].name}; Last: ${ledger.packages.at(-1).name}.`);
}

function commandPreflight() {
  const failures = [];
  for (const entry of lockedPackages) {
    try {
      validateSourceManifest(initialEntry(entry), loadSourceManifest(entry));
    } catch (error) {
      failures.push(error.message);
    }
  }

  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
  if (!/^## \[1\.0\.0-beta\.1\] - \d{4}-\d{2}-\d{2}$/mu.test(changelog)) {
    failures.push('CHANGELOG.md must contain a ## [1.0.0-beta.1] - YYYY-MM-DD section.');
  }

  if (existsSync(ledgerPath)) {
    try {
      validateLedgerShape(readJson(ledgerPath));
    } catch (error) {
      failures.push(error.message);
    }
  }

  console.log(`Metadata preflight checked ${lockedPackages.length} package manifests.`);
  console.log('Required run-once global gate sequence:');
  globalGateCommands.forEach(({ command, args, env }, index) => {
    const prefix = String(index + 1).padStart(2, '0');
    const envPrefix = env ? `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join(' ')} ` : '';
    console.log(`${prefix}. ${envPrefix}${commandLine(command, args)}`);
  });
  console.log(`Global gate evidence directory: ${relative(repoRoot, globalGateRoot)}`);

  if (failures.length > 0) {
    throw new Error(`Preflight failed:\n- ${failures.join('\n- ')}`);
  }
}

function commandDryRun(options) {
  const ledger = loadLedger();
  ensureDirectory(dryRunRoot);
  ensureDirectory(join(dryRunRoot, 'tarballs'));

  for (const entry of selectedEntries(ledger, options)) {
    ensureSequentialBefore(ledger, entry);

    if (immutableSuccessStatuses.has(entry.status) || entry.status === 'dry-run-passed') {
      console.log(`${entry.name}: ${entry.status}; skipping dry-run.`);
      continue;
    }

    if (entry.status !== 'pending') {
      throw new Error(`${entry.name}: dry-run only accepts pending entries, found ${entry.status}.`);
    }

    const slug = slugFor(entry.name);
    const logPath = join(dryRunRoot, `${slug}.log`);
    const temporaryLogPath = `${logPath}.tmp`;
    const manifestEvidencePath = join(dryRunRoot, `${slug}.manifest.json`);
    const filesEvidencePath = join(dryRunRoot, `${slug}.files.txt`);
    const summaryEvidencePath = join(dryRunRoot, `${slug}.summary.json`);
    const tarballDirectory = join(dryRunRoot, 'tarballs');
    const logLines = [`# Dry-run validation for ${entry.name}`, `Started: ${now()}`, `Package dir: ${entry.dir}`];

    try {
      const sourceManifest = loadSourceManifest(entry);
      validateSourceManifest(entry, sourceManifest);
      const beforeTarballs = readdirSync(tarballDirectory).filter((file) => file.endsWith('.tgz'));
      const packArgs = ['--dir', entry.dir, 'pack', '--pack-destination', tarballDirectory];
      logLines.push(`$ ${commandLine('pnpm', packArgs)}`);
      const packResult = run('pnpm', packArgs);
      logLines.push(packResult.stdout.trim(), packResult.stderr.trim(), `pack exit code: ${packResult.status ?? 1}`);
      if (packResult.status !== 0) {
        throw Object.assign(new Error('pnpm pack failed'), packResult);
      }

      const tarballPath = newestTarball(tarballDirectory, beforeTarballs);
      const files = tarList(tarballPath);
      const packedManifest = JSON.parse(tarRead(tarballPath, 'package/package.json'));
      writeJsonAtomic(manifestEvidencePath, packedManifest);
      writeFileSync(filesEvidencePath, `${files.join('\n')}\n`, 'utf8');
      const checks = validatePackedManifest(entry, sourceManifest, packedManifest, files, logLines);

      const publishDryRunArgs = ['--dir', entry.dir, 'publish', '--dry-run', '--access', 'public', '--tag', distTag, '--no-git-checks'];
      logLines.push(`$ ${commandLine('pnpm', publishDryRunArgs)}`);
      const publishDryRunResult = run('pnpm', publishDryRunArgs);
      logLines.push(
        publishDryRunResult.stdout.trim(),
        publishDryRunResult.stderr.trim(),
        `publish dry-run exit code: ${publishDryRunResult.status ?? 1}`,
      );
      if (publishDryRunResult.status !== 0) {
        throw Object.assign(new Error('pnpm publish --dry-run failed'), publishDryRunResult);
      }

      entry.status = 'dry-run-passed';
      entry.timestamps.dryRunPassedAt = now();
      entry.lastError = null;
      entry.evidencePaths.dryRunLog = relative(repoRoot, logPath);
      writeJsonAtomic(summaryEvidencePath, {
        packageName: entry.name,
        packageDir: entry.dir,
        slug,
        version: targetVersion,
        packExitCode: packResult.status,
        publishDryRunExitCode: publishDryRunResult.status,
        checks,
        tarballPath: relative(repoRoot, tarballPath),
        evidencePaths: {
          dryRunLog: relative(repoRoot, logPath),
          manifest: relative(repoRoot, manifestEvidencePath),
          files: relative(repoRoot, filesEvidencePath),
          summary: relative(repoRoot, summaryEvidencePath),
        },
      });
      logLines.push(`Completed: ${now()}`, 'Result: dry-run-passed');
      writeFileSync(temporaryLogPath, `${logLines.filter(Boolean).join('\n')}\n`, 'utf8');
      renameSync(temporaryLogPath, logPath);
      saveLedger(ledger);
      console.log(`${entry.name}: dry-run-passed`);
    } catch (error) {
      logLines.push(`Failed: ${now()}`, error.stack ?? error.message);
      writeFileSync(temporaryLogPath, `${logLines.filter(Boolean).join('\n')}\n`, 'utf8');
      renameSync(temporaryLogPath, logPath);
      setFailure(entry, 'dry-run', error, logPath);
      entry.evidencePaths.dryRunLog = relative(repoRoot, logPath);
      saveLedger(ledger);
      throw error;
    }
  }
}

function outputLooksAuthRelated(output) {
  return /\b(EOTP|ENEEDAUTH|E401|one-time pass|otp|auth|login|two-factor|2fa)\b/iu.test(output);
}

function outputLooksNetworkAmbiguous(output) {
  return /\b(ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|network|timeout)\b/iu.test(output);
}

function commandPublish(options) {
  const ledger = loadLedger();
  ensureDirectory(publishRoot);

  for (const entry of selectedEntries(ledger, options)) {
    ensureSequentialBefore(ledger, entry);

    if (immutableSuccessStatuses.has(entry.status)) {
      console.log(`${entry.name}: ${entry.status}; skipping publish.`);
      continue;
    }
    if (entry.status === 'published' || entry.status === 'publish-started') {
      throw new Error(`${entry.name}: ${entry.status}; do not republish. Run verify --package ${entry.name}.`);
    }
    if (entry.status !== 'dry-run-passed') {
      throw new Error(`${entry.name}: publish requires dry-run-passed, found ${entry.status}.`);
    }

    const slug = slugFor(entry.name);
    const logPath = join(publishRoot, `${slug}.log`);
    const args = ['--dir', entry.dir, 'publish', '--access', 'public', '--tag', distTag, '--no-git-checks'];
    entry.status = 'publish-started';
    entry.attemptCount += 1;
    entry.timestamps.publishStartedAt = now();
    entry.evidencePaths.publishLog = relative(repoRoot, logPath);
    saveLedger(ledger);

    const result = run('pnpm', args);
    const output = [`# Publish for ${entry.name}`, `Started: ${entry.timestamps.publishStartedAt}`, `$ ${commandLine('pnpm', args)}`, result.stdout, result.stderr, `exit code: ${result.status ?? 1}`]
      .filter(Boolean)
      .join('\n');
    writeFileSync(logPath, `${output}\n`, 'utf8');

    if (result.status === 0) {
      entry.status = 'published';
      entry.timestamps.publishedAt = now();
      entry.lastError = null;
      saveLedger(ledger);
      ensureDirectory(registryRoot);
      verifyEntry(ledger, entry);
      console.log(`${entry.name}: published and verify-passed`);
      continue;
    }

    const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (outputLooksNetworkAmbiguous(combinedOutput) && !outputLooksAuthRelated(combinedOutput)) {
      entry.lastError = {
        command: commandLine('pnpm', args),
        exitCode: result.status ?? 1,
        message: combinedOutput.trim(),
        evidencePath: relative(repoRoot, logPath),
        occurredAt: now(),
      };
      saveLedger(ledger);
      throw new Error(
        `${entry.name}: publish outcome is network-ambiguous and remains publish-started. Run verify --package ${entry.name} before retrying.`,
      );
    }

    setFailure(entry, commandLine('pnpm', args), result, logPath);
    saveLedger(ledger);
    const resumeHint = outputLooksAuthRelated(combinedOutput)
      ? `Auth/OTP failure detected. Re-authenticate with npm, then run: node ${relative(repoRoot, fileURLToPath(import.meta.url))} verify --package ${entry.name}; if not published, intentionally reset after reconciliation and rerun publish.`
      : `Fix the failure, reconcile npm registry for ${entry.name}@${targetVersion}, then run resume-check.`;
    throw new Error(`${entry.name}: publish failed. ${resumeHint}`);
  }
}

function registryQuery(entry) {
  const versionResult = run('npm', ['view', `${entry.name}@${targetVersion}`, 'version', '--json']);
  const tagsResult = run('npm', ['view', entry.name, 'dist-tags', '--json']);
  const version = versionResult.status === 0 ? JSON.parse(versionResult.stdout) : null;
  const distTags = tagsResult.status === 0 ? JSON.parse(tagsResult.stdout) : null;

  return { versionResult, tagsResult, version, distTags };
}

function verifyEntry(ledger, entry) {
  const slug = slugFor(entry.name);
  const registryPath = join(registryRoot, `${slug}.json`);
  const query = registryQuery(entry);
  const evidence = {
    packageName: entry.name,
    version: query.version,
    distTags: query.distTags,
    expectedVersion: targetVersion,
    expectedDistTag: distTag,
    versionExitCode: query.versionResult.status,
    distTagsExitCode: query.tagsResult.status,
    checkedAt: now(),
    stderr: `${query.versionResult.stderr ?? ''}${query.tagsResult.stderr ?? ''}`.trim(),
  };
  writeJsonAtomic(registryPath, evidence);
  entry.evidencePaths.registryJson = relative(repoRoot, registryPath);

  if (query.version === targetVersion && query.distTags?.[distTag] === targetVersion) {
    entry.status = 'verify-passed';
    entry.timestamps.verifiedAt = now();
    entry.lastError = null;
    saveLedger(ledger);
    return registryPath;
  }

  setFailure(entry, 'npm registry verify', { status: 1, stderr: evidence.stderr, stdout: JSON.stringify(evidence) }, registryPath);
  saveLedger(ledger);
  throw new Error(`${entry.name}: registry did not confirm ${targetVersion} with beta dist-tag. Evidence: ${relative(repoRoot, registryPath)}`);
}

function commandVerify(options) {
  const ledger = loadLedger();
  ensureDirectory(registryRoot);

  for (const entry of selectedEntries(ledger, options)) {
    if (entry.status === 'failed') {
      console.log(`${entry.name}: failed; verifying registry for reconciliation only.`);
    }

    verifyEntry(ledger, entry);
    console.log(`${entry.name}: verify-passed`);
  }
}

function computeResumeAdvice(ledger) {
  for (const entry of ledger.packages) {
    if (immutableSuccessStatuses.has(entry.status)) {
      continue;
    }
    if (entry.status === 'published' || entry.status === 'publish-started') {
      return { blocked: true, message: `${entry.name} is ${entry.status}; run verify --package ${entry.name} before any publish retry.` };
    }
    if (entry.status === 'failed') {
      return { blocked: true, message: `${entry.name} is failed; fix root cause, reconcile registry, then intentionally retry this package.` };
    }
    if (entry.status === 'dry-run-passed') {
      return { blocked: false, message: `Next publish candidate: ${entry.name}. Run publish --package ${entry.name} or publish --all.` };
    }
    return { blocked: false, message: `Next dry-run candidate: ${entry.name}. Run dry-run --package ${entry.name} or dry-run --all.` };
  }
  return { blocked: false, message: 'All packages are immutable success.' };
}

function assertNoOutOfOrderProgress(ledger) {
  let foundNonSuccess = false;
  for (const entry of ledger.packages) {
    if (!immutableSuccessStatuses.has(entry.status)) {
      foundNonSuccess = true;
      continue;
    }
    if (foundNonSuccess) {
      throw new Error(`${entry.name} is ${entry.status} after an earlier non-success entry; ledger is out of order.`);
    }
  }
}

function commandResumeCheck() {
  const ledger = loadLedger();
  assertNoOutOfOrderProgress(ledger);
  const advice = computeResumeAdvice(ledger);
  const logPath = join(resumeRoot, 'resume-check.log');
  ensureDirectory(resumeRoot);
  writeFileSync(logPath, `${now()} ${advice.blocked ? 'BLOCKED' : 'READY'} ${advice.message}\n`, 'utf8');
  console.log(`${advice.blocked ? 'BLOCKED' : 'READY'}: ${advice.message}`);
  console.log(`Evidence: ${relative(repoRoot, logPath)}`);
  if (advice.blocked) {
    process.exitCode = 2;
  }
}

function commandSummary() {
  const ledger = existsSync(ledgerPath) ? loadLedger() : createLedger();
  const counts = new Map([...allowedStatuses].map((status) => [status, 0]));
  for (const entry of ledger.packages) {
    counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  }
  console.log(`Target: ${targetVersion} (${distTag})`);
  console.log(`Ledger: ${relative(repoRoot, ledgerPath)} ${existsSync(ledgerPath) ? '' : '(not initialized)'}`.trim());
  console.log(`Packages: ${ledger.packages.length}`);
  for (const [status, count] of counts) {
    console.log(`- ${status}: ${count}`);
  }
  console.log(computeResumeAdvice(ledger).message);
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }

  const options = parseOptions(rest);
  if (command === 'init') {
    commandInit(options);
  } else if (command === 'preflight') {
    commandPreflight();
  } else if (command === 'dry-run') {
    commandDryRun(options);
  } else if (command === 'publish') {
    commandPublish(options);
  } else if (command === 'verify') {
    commandVerify(options);
  } else if (command === 'resume-check') {
    commandResumeCheck();
  } else if (command === 'summary') {
    commandSummary();
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = process.exitCode || 1;
}
