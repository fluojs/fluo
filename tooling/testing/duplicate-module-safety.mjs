import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { schemaFailure } from '../../.agents/workflow-contracts/schema-validator.mjs';
import { publicWorkspacePackageNames, workspacePackageManifests } from '../release/release-intents.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(here, '..', '..');
const filesystemRoot = (root) => root instanceof URL ? fileURLToPath(root) : root;
const schemaPath = (root = defaultRoot) => join(filesystemRoot(root), 'tooling/testing/duplicate-module-safety-coverage.schema.json');
export const coverageManifestPath = (root = defaultRoot) => join(filesystemRoot(root), 'tooling/testing/duplicate-module-safety-coverage.json');

const topologyKinds = new Set(['same-version-different-path', 'compatible-patch-skew', 'incompatible-major-strict-peer']);
const platformStatuses = new Set(['native', 'host-evidence', 'not-applicable']);
const surfaces = new Set(['errors', 'di-singleton', 'di-request', 'request-context', 'sse', 'jwt-passport', 'rollback', 'react-render', 'metadata']);

function timeoutError(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs}ms.`);
}

export function publicPackageNames(root = defaultRoot) {
  return publicWorkspacePackageNames(workspacePackageManifests(filesystemRoot(root)));
}

export function loadCoverageManifest(root = defaultRoot) {
  return JSON.parse(readFileSync(coverageManifestPath(filesystemRoot(root)), 'utf8'));
}

function checkedPath(root, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || isAbsolute(candidate)) return false;
  const resolved = resolve(root, candidate);
  return resolved.startsWith(`${resolve(root)}/`) && existsSync(resolved);
}

export function validateCoverageManifest(manifest, { root = defaultRoot } = {}) {
  root = filesystemRoot(root);
  const failures = [];
  const schema = JSON.parse(readFileSync(schemaPath(root), 'utf8'));
  const schemaIssue = schemaFailure(schema, manifest, 'coverage');
  if (schemaIssue !== null) failures.push(schemaIssue);
  if (!manifest || !Array.isArray(manifest.packages)) return failures;

  const expected = publicPackageNames(root);
  const actual = manifest.packages.map((entry) => entry?.package);
  const seen = new Set();
  for (const [index, entry] of manifest.packages.entries()) {
    const location = `packages[${index}]`;
    if (!entry || typeof entry !== 'object') continue;
    if (seen.has(entry.package)) failures.push(`${location} duplicates package ${entry.package}.`);
    seen.add(entry.package);
    if (!expected.includes(entry.package)) failures.push(`${location} references unknown public package ${entry.package}.`);
    if (!Array.isArray(entry.topologies) || entry.topologies.some((topology) => !topologyKinds.has(topology))) {
      failures.push(`${location} has unsupported topology.`);
    }
    if (!Array.isArray(entry.surfaces) || entry.surfaces.some((surface) => !surfaces.has(surface))) {
      failures.push(`${location} has unsupported observable surface.`);
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0 || entry.evidence.some((path) => !checkedPath(root, path))) {
      failures.push(`${location} has missing evidence path.`);
    }
    for (const status of Object.values(entry.platforms ?? {})) {
      if (!platformStatuses.has(status)) failures.push(`${location} has unsupported platform status.`);
    }
    if (entry.status === 'applied' && (entry.topologies.length === 0 || entry.surfaces.length === 0)) {
      failures.push(`${location} is applied without topology or surface coverage.`);
    }
    if (entry.status === 'not-applicable' && entry.surfaces.length !== 0) {
      failures.push(`${location} is not-applicable but claims a surface.`);
    }
  }
  if (actual.length !== expected.length) failures.push(`coverage rows (${actual.length}) do not match derived public package inventory (${expected.length}).`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push('coverage rows are not the lexicographically ordered derived public package inventory.');
  return failures;
}

function commandRecord(argv, cwd, timeoutMs, environment = {}) {
  const startedAt = Date.now();
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectCommand(timeoutError(argv.join(' '), timeoutMs));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      const record = { argv, elapsedMs: Date.now() - startedAt, exitCode, signal, stderr, stdout };
      if (exitCode !== 0) {
        rejectCommand(new Error(`${argv.join(' ')} failed (exit ${exitCode}, signal ${signal}): ${stdout.slice(-2_000)}${stderr.slice(-2_000)}`));
        return;
      }
      resolveCommand(record);
    });
  });
}

function packageRecord(root, packageName) {
  const record = workspacePackageManifests(root).find(({ manifest }) => manifest.name === packageName);
  if (!record) throw new Error(`Cannot locate workspace package ${packageName}.`);
  return record;
}

function packageDirectory(record) {
  return dirname(record.packageJsonPath);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function packPackage({ root, sandbox, packageName, side, timeoutMs, commands }) {
  const record = packageRecord(root, packageName);
  const target = join(sandbox, 'artifacts', side, packageName.replace('@fluojs/', '').replaceAll('/', '-'));
  const packed = await commandRecord(
    ['pnpm', '--dir', packageDirectory(record), 'pack', '--pack-destination', target],
    root,
    timeoutMs,
    { npm_config_registry: 'http://127.0.0.1:9', npm_config_offline: 'true' },
  );
  commands.push(packed);
  const tarballs = readdirSync(target).filter((entry) => entry.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`pnpm pack did not create one local artifact for ${packageName}: ${packed.stdout}${packed.stderr}`);
  return join(target, tarballs[0]);
}

async function createCompatiblePatchArtifact({ source, sandbox, timeoutMs, commands }) {
  const unpacked = join(sandbox, 'artifacts', 'compatible-patch-skew');
  mkdirSync(unpacked, { recursive: true });
  commands.push(await commandRecord(['tar', '-xzf', source, '-C', unpacked], sandbox, timeoutMs));
  const manifestPath = join(unpacked, 'package', 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const version = manifest.version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/u);
  if (!version) throw new Error(`Cannot synthesize a patch skew from ${manifest.version}.`);
  manifest.version = `${version[1]}.${version[2]}.${Number(version[3]) + 1}${version[4]}`;
  writeJson(manifestPath, manifest);
  const target = join(sandbox, 'artifacts', 'B', 'core-compatible-patch-skew.tgz');
  commands.push(await commandRecord(['tar', '-czf', target, '-C', unpacked, 'package'], sandbox, timeoutMs));
  return target;
}

function createConsumer({ sandbox, side, sourceSide = side, artifacts, fixtureRoot }) {
  const consumerRoot = join(sandbox, `consumer-${side.toLowerCase()}`);
  mkdirSync(consumerRoot, { recursive: true });
  writeJson(join(consumerRoot, 'package.json'), {
    name: `duplicate-module-safety-consumer-${side.toLowerCase()}`,
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(Object.entries(artifacts).map(([name, tarball]) => [name, tarball])),
    pnpm: { overrides: Object.fromEntries(Object.entries(artifacts).map(([name, tarball]) => [name, `file:${tarball}`])) },
  });
  writeFileSync(join(consumerRoot, 'consumer.mjs'), readFileSync(join(fixtureRoot, `consumer-${sourceSide.toLowerCase()}.mjs`), 'utf8'));
  return consumerRoot;
}

async function inspectConsumer({ root, consumerRoot, side, timeoutMs, commands }) {
  const install = await commandRecord(
    ['pnpm', '--dir', consumerRoot, 'install', '--ignore-workspace', '--offline', '--ignore-scripts', '--lockfile=false'],
    root,
    timeoutMs,
    { npm_config_registry: 'http://127.0.0.1:9', npm_config_offline: 'true' },
  );
  commands.push(install);
  const inspected = await commandRecord(['node', 'consumer.mjs'], consumerRoot, timeoutMs);
  commands.push(inspected);
  return { ...JSON.parse(inspected.stdout), artifact: side };
}

export async function runDuplicateModuleSafety({
  root = defaultRoot,
  packageNames = ['@fluojs/core', '@fluojs/di'],
  timeoutMs = 120_000,
} = {}) {
  root = filesystemRoot(root);
  const coverageFailures = validateCoverageManifest(loadCoverageManifest(root), { root });
  if (coverageFailures.length > 0) throw new Error(`Coverage manifest invalid: ${coverageFailures.join(' ')}`);
  const fixtureRoot = join(root, 'packages/testing/fixtures/duplicate-module-safety');
  const preparation = [
    await commandRecord(['pnpm', 'install', '--offline', '--frozen-lockfile'], root, timeoutMs, {
      npm_config_registry: 'http://127.0.0.1:9',
      npm_config_offline: 'true',
    }),
  ];
  for (const packageName of packageNames) {
    preparation.push(await commandRecord(
      ['node', 'tooling/scripts/run-workspace-build-closure.mjs', packageName],
      root,
      timeoutMs,
    ));
  }
  const runs = [];
  for (const runNumber of [1, 2]) {
    const sandbox = mkdtempSync(join(tmpdir(), 'fluo-duplicate-module-safety-'));
    const commands = [...preparation];
    let primaryError;
    let cleanupError;
    try {
      const artifacts = { A: {}, B: {} };
      for (const packageName of packageNames) {
        artifacts.A[packageName] = await packPackage({ root, sandbox, packageName, side: 'A', timeoutMs, commands });
        artifacts.B[packageName] = await packPackage({ root, sandbox, packageName, side: 'B', timeoutMs, commands });
      }
      const compatibleArtifacts = { ...artifacts.B };
      compatibleArtifacts['@fluojs/core'] = await createCompatiblePatchArtifact({
        commands,
        sandbox,
        source: artifacts.B['@fluojs/core'],
        timeoutMs,
      });
      const consumerA = createConsumer({ sandbox, side: 'A', artifacts: artifacts.A, fixtureRoot });
      const consumerB = createConsumer({ sandbox, side: 'B', artifacts: artifacts.B, fixtureRoot });
      const consumerCompatible = createConsumer({
        artifacts: compatibleArtifacts,
        fixtureRoot,
        sandbox,
        side: 'C',
        sourceSide: 'B',
      });
      const [a, b] = await Promise.all([
        inspectConsumer({ root, consumerRoot: consumerA, side: 'A', timeoutMs, commands }),
        inspectConsumer({ root, consumerRoot: consumerB, side: 'B', timeoutMs, commands }),
      ]);
      const compatible = await inspectConsumer({
        root,
        consumerRoot: consumerCompatible,
        side: 'C',
        timeoutMs,
        commands,
      });
      if (a.realPath === b.realPath || a.version !== b.version || a.realPath === compatible.realPath
        || a.version === compatible.version || a.package !== '@fluojs/core' || b.package !== '@fluojs/core') {
        throw new Error('Packed consumers did not resolve distinct @fluojs/core artifacts.');
      }
      for (const consumer of [a, b, compatible]) {
        if (consumer.surfaces?.error !== 'DUPLICATE_MODULE_SAFETY'
          || consumer.surfaces?.singleton !== true || consumer.surfaces?.requestScope !== true) {
          throw new Error(`Canonical core/DI surface validation failed for consumer ${consumer.artifact}.`);
        }
      }
      const app = await import(`${pathToFileURL(join(fixtureRoot, 'app.mjs')).href}?run=${runNumber}`);
      const listenerEvidence = await app.exerciseListeners({ a, b, timeoutMs });
      const peerFixture = join(sandbox, 'strict-peer');
      const peerConsumer = join(sandbox, 'strict-peer-consumer');
      mkdirSync(peerFixture, { recursive: true });
      mkdirSync(peerConsumer, { recursive: true });
      writeJson(join(peerFixture, 'package.json'), {
        name: 'duplicate-module-safety-incompatible-peer',
        private: true,
        peerDependencies: { '@fluojs/core': '^999.0.0' },
      });
      writeJson(join(peerConsumer, 'package.json'), {
        name: 'duplicate-module-safety-strict-peer-consumer',
        private: true,
        dependencies: {
          '@fluojs/core': artifacts.A['@fluojs/core'],
          'duplicate-module-safety-incompatible-peer': `file:${peerFixture}`,
        },
      });
      const rejected = await commandRecord(
        ['pnpm', '--dir', peerConsumer, 'install', '--ignore-workspace', '--offline', '--ignore-scripts', '--lockfile=false', '--strict-peer-dependencies'],
        root,
        timeoutMs,
        { npm_config_registry: 'http://127.0.0.1:9', npm_config_offline: 'true' },
      ).then(() => null, (error) => String(error));
      if (!rejected?.includes('@fluojs/core') || !rejected.includes('999')) {
        throw new Error('Incompatible strict-peer topology did not reject the declared @fluojs/core range before runtime load.');
      }
      runs.push({
        commands,
        consumers: { a, b, compatible },
        listenerEvidence,
        runNumber,
        sandboxRemoved: false,
        topologies: [
          { kind: 'same-version-different-path', status: 'passed', evidence: `${a.version} / ${b.version}` },
          { kind: 'compatible-patch-skew', status: 'passed', evidence: `${a.version} / ${compatible.version}` },
          { kind: 'incompatible-major-strict-peer', status: 'rejected', evidence: rejected },
        ],
      });
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        rmSync(sandbox, { force: true, recursive: true });
        if (runs.length > 0) runs.at(-1).sandboxRemoved = !existsSync(sandbox);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (primaryError || cleanupError) {
      throw new AggregateError([primaryError, cleanupError].filter(Boolean), 'duplicate-module-safety run failed');
    }
  }
  if (runs[0].consumers.a.realPath === runs[1].consumers.a.realPath) {
    throw new Error('Independent runs reused consumer state.');
  }
  return { network: 'disabled', runs, status: 'passed' };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = await runDuplicateModuleSafety();
  console.log(JSON.stringify(result));
}
