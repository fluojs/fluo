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
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { schemaFailure } from '../../.agents/workflow-contracts/schema-validator.mjs';
import { publicWorkspacePackageNames, workspacePackageManifests } from '../release/release-intents.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(here, '..', '..');
const filesystemRoot = (root) => root instanceof URL ? fileURLToPath(root) : root;
const schemaPath = (root = defaultRoot) => join(filesystemRoot(root), 'tooling/testing/duplicate-module-safety-coverage.schema.json');
export const coverageManifestPath = (root = defaultRoot) => join(filesystemRoot(root), 'tooling/testing/duplicate-module-safety-coverage.json');

const topologyKinds = new Set(['same-version-different-path', 'compatible-patch-skew', 'incompatible-major-strict-peer']);
const platformStatuses = new Set(['native', 'host-evidence', 'not-applicable']);
const surfaces = new Set(['errors', 'di-singleton', 'di-request', 'request-context', 'sse', 'jwt-passport', 'rollback', 'react-render', 'metadata', 'adapter-listener']);
const exercisedPackageSeeds = [
  '@fluojs/core',
  '@fluojs/di',
  '@fluojs/http',
  '@fluojs/jwt',
  '@fluojs/mongoose',
  '@fluojs/passport',
  '@fluojs/react',
  '@fluojs/runtime',
  '@fluojs/platform-nodejs',
  '@fluojs/platform-fastify',
  '@fluojs/platform-express',
];

function timeoutError(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs}ms.`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
    if (entry.package !== '@fluojs/core' && entry.topologies.includes('incompatible-major-strict-peer')) {
      failures.push(`${location} claims incompatible-major strict-peer evidence only demonstrated for @fluojs/core.`);
    }
  }
  if (actual.length !== expected.length) failures.push(`coverage rows (${actual.length}) do not match derived public package inventory (${expected.length}).`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push('coverage rows are not the lexicographically ordered derived public package inventory.');
  return failures;
}

export function commandRecord(argv, cwd, timeoutMs, environment = {}, ready = null) {
  const startedAt = Date.now();
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let escalation;
    let timer;
    const terminateProcessGroup = (signal) => {
      if (child.pid === undefined) return;
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    };
    const startTimeout = () => {
      timer = setTimeout(() => {
        timedOut = true;
        terminateProcessGroup('SIGTERM');
        escalation = setTimeout(() => terminateProcessGroup('SIGKILL'), Math.min(1_000, timeoutMs));
      }, timeoutMs);
    };
    const readinessTimer = ready && setTimeout(() => {
      terminateProcessGroup('SIGTERM');
      rejectCommand(timeoutError(`${argv.join(' ')} readiness`, 10_000));
    }, 10_000);
    const checkReady = () => {
      if (ready && stdout.includes(ready.stdout) && stderr.includes(ready.stderr)) {
        clearTimeout(readinessTimer);
        ready = null;
        startTimeout();
      }
    };
    if (!ready) startTimeout();
    child.stdout.on('data', (chunk) => { stdout += chunk; checkReady(); });
    child.stderr.on('data', (chunk) => { stderr += chunk; checkReady(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      clearTimeout(readinessTimer);
      clearTimeout(escalation);
      rejectCommand(error);
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(readinessTimer);
      clearTimeout(escalation);
      const record = { argv, elapsedMs: Date.now() - startedAt, exitCode, signal, stderr, stdout };
      if (timedOut) {
        const error = timeoutError(argv.join(' '), timeoutMs);
        error.record = record;
        rejectCommand(error);
        return;
      }
      if (exitCode !== 0) {
        const error = new Error(`${argv.join(' ')} failed (exit ${exitCode}, signal ${signal}): ${stdout.slice(-2_000)}${stderr.slice(-2_000)}`);
        error.record = record;
        rejectCommand(error);
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

export function workspaceDependencyClosure(root, packageNames = exercisedPackageSeeds) {
  root = filesystemRoot(root);
  const records = new Map(workspacePackageManifests(root).map((record) => [record.manifest.name, record]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (packageName) => {
    if (visited.has(packageName)) return;
    if (visiting.has(packageName)) throw new Error(`Workspace dependency cycle includes ${packageName}.`);
    const record = records.get(packageName);
    if (!record) throw new Error(`Cannot locate workspace package ${packageName}.`);
    visiting.add(packageName);
    const dependencies = [
      ...Object.keys(record.manifest.dependencies ?? {}),
      ...Object.keys(record.manifest.optionalDependencies ?? {}),
      ...Object.keys(record.manifest.peerDependencies ?? {}),
    ].filter((dependency) => records.has(dependency)).sort();
    for (const dependency of dependencies) visit(dependency);
    visiting.delete(packageName);
    visited.add(packageName);
    ordered.push(packageName);
  };
  for (const packageName of packageNames) visit(packageName);
  return ordered;
}

function packageDirectory(record) {
  return dirname(record.packageJsonPath);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function packPackage({ root, sandbox, packageName, side, timeoutMs, commands, packedArtifacts = {} }) {
  const record = packageRecord(root, packageName);
  const packageSlug = packageName.replace('@fluojs/', '').replaceAll('/', '-');
  const rawTarget = join(sandbox, 'raw-artifacts', packageSlug);
  const packed = await commandRecord(
    ['pnpm', '--dir', packageDirectory(record), 'pack', '--pack-destination', rawTarget],
    root,
    timeoutMs,
    { npm_config_offline: 'true' },
  );
  commands.push(packed);
  const tarballs = readdirSync(rawTarget).filter((entry) => entry.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`pnpm pack did not create one local artifact for ${packageName}: ${packed.stdout}${packed.stderr}`);
  const stagedRoot = join(sandbox, 'staged-publish-tree', side, packageSlug);
  mkdirSync(stagedRoot, { recursive: true });
  const rawTarball = join(rawTarget, tarballs[0]);
  commands.push(await commandRecord(['tar', '-xzf', rawTarball, '-C', stagedRoot], sandbox, timeoutMs));
  const packageRoot = join(stagedRoot, 'package');
  const marker = `${side}:${packageName}:${sha256(`${side}:${packageName}`)}`;
  const markerPath = join(packageRoot, 'fixture-artifact.json');
  const manifestPath = join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entrySha256 = sha256(readFileSync(join(packageRoot, 'dist/index.js')));
  for (const dependencyKind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dependency, tarball] of Object.entries(packedArtifacts)) {
      if (manifest[dependencyKind]?.[dependency] !== undefined) {
        manifest[dependencyKind][dependency] = `file:${tarball}`;
      }
    }
  }
  manifest.fluoDuplicateModuleSafety = { artifact: side, marker, version: 1 };
  writeJson(manifestPath, manifest);
  writeJson(markerPath, { artifact: side, entrySha256, marker, package: packageName, version: 1 });
  const target = join(sandbox, 'artifacts', side, `${packageSlug}.tgz`);
  mkdirSync(dirname(target), { recursive: true });
  commands.push(await commandRecord(['tar', '-czf', target, '-C', stagedRoot, 'package'], sandbox, timeoutMs));
  return { entrySha256, integrity: sha256(readFileSync(target)), marker, tarball: target };
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

function createConsumer({ root, sandbox, side, artifacts, fixtureRoot }) {
  const consumerRoot = join(sandbox, `consumer-${side.toLowerCase()}`);
  mkdirSync(consumerRoot, { recursive: true });
  const externalDependencies = {
    react: `file:${realpathSync(join(root, 'packages', 'react', 'node_modules', 'react'))}`,
  };
  writeJson(join(consumerRoot, 'package.json'), {
    name: `duplicate-module-safety-consumer-${side.toLowerCase()}`,
    private: true,
    type: 'module',
    exports: './consumer.mjs',
    dependencies: {
      ...Object.fromEntries(Object.entries(artifacts).map(([name, tarball]) => [name, tarball])),
      ...externalDependencies,
    },
    pnpm: { overrides: Object.fromEntries(Object.entries(artifacts).map(([name, tarball]) => [name, `file:${tarball}`])) },
  });
  writeFileSync(join(consumerRoot, 'consumer.mjs'), readFileSync(join(fixtureRoot, 'consumer-a.mjs'), 'utf8'));
  return consumerRoot;
}

function createRootConsumer({ sandbox, consumers }) {
  const rootConsumer = join(sandbox, 'root-consumer');
  mkdirSync(rootConsumer, { recursive: true });
  writeJson(join(rootConsumer, 'package.json'), {
    name: 'duplicate-module-safety-root',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(Object.entries(consumers)
      .map(([side, path]) => [`duplicate-module-safety-consumer-${side.toLowerCase()}`, `file:${path}`])),
  });
  writeFileSync(join(rootConsumer, 'root.mjs'), [
    "import { observation as a, interop as apiA } from 'duplicate-module-safety-consumer-a';",
    "import { observation as b, interop as apiB } from 'duplicate-module-safety-consumer-b';",
    'async function crossCopy(owner, consumer, ownerObservation) {',
    '  const sse = owner.createSse();',
    '  const completion = consumer.waitForSseResponseCompletion(sse);',
    '  const sseCompatible = consumer.isCompatibleSseResponse(sse);',
    '  sse.close();',
    '  await completion;',
    '  const [jwt, rollback, react] = await Promise.all([',
    '    consumer.authenticateToken(ownerObservation.surfaces.jwtPassport.token),',
    '    consumer.rollbackForeignError(owner.error),',
    '    consumer.renderForeignReact(owner.createReactEntry(), ownerObservation.artifact),',
    '  ]);',
    '  return {',
    "    error: consumer.isFluoError(owner.error, '@fluojs/core'),",
    '    singleton: (await owner.container.resolve(consumer.singletonToken)).kind,',
    '    request: (await owner.container.createRequestScope().resolve(consumer.requestToken)).kind,',
    '    context: await owner.runWithRequestContext(owner.requestContext(), () => consumer.getCurrentRequestContext()?.requestId),',
    '    metadata: consumer.getModuleMetadata(owner.module)?.providers?.length > 0,',
    '    sse: sseCompatible,',
    '    jwt: { status: jwt.status, subject: jwt.body?.principal?.subject },',
    '    rollback,',
    '    react: { status: react.status, body: react.body },',
    '  };',
    '}',
    'console.log(JSON.stringify({ a, b, cross: { aToB: await crossCopy(apiA, apiB, a), bToA: await crossCopy(apiB, apiA, b) } }));',
    '',
  ].join('\n'));
  return rootConsumer;
}

function parseStructuredOutput(stdout, label) {
  for (const line of stdout.trim().split('\n').reverse()) {
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Framework diagnostics can precede the final machine-consumed JSON record.
    }
  }
  throw new Error(`${label} did not emit a final JSON record: ${stdout.slice(-2_000)}`);
}

async function inspectConsumer({ root, consumerRoot, side, timeoutMs, commands, packageClosure }) {
  const install = await commandRecord(
    ['pnpm', '--dir', consumerRoot, 'install', '--config.node-linker=isolated', '--ignore-workspace', '--offline', '--ignore-scripts', '--lockfile=false'],
    root,
    timeoutMs,
    { npm_config_offline: 'true' },
  );
  commands.push(install);
  const inspected = await commandRecord(['node', 'consumer.mjs'], consumerRoot, timeoutMs, {
    FLUO_DUPLICATE_PACKAGE_NAMES: JSON.stringify(packageClosure),
  });
  commands.push(inspected);
  return parseStructuredOutput(inspected.stdout, `consumer ${side}`);
}

async function inspectRootConsumer({ root, consumerRoot, timeoutMs, commands, packageClosure }) {
  const install = await commandRecord(
    ['pnpm', '--dir', consumerRoot, 'install', '--config.node-linker=isolated', '--ignore-workspace', '--offline', '--ignore-scripts', '--lockfile=false'],
    root,
    timeoutMs,
    { npm_config_offline: 'true' },
  );
  commands.push(install);
  const inspected = await commandRecord(['node', 'root.mjs'], consumerRoot, timeoutMs, {
    FLUO_DUPLICATE_PACKAGE_NAMES: JSON.stringify(packageClosure),
  });
  commands.push(inspected);
  return parseStructuredOutput(inspected.stdout, 'root consumer');
}

export async function runDuplicateModuleSafety({
  root = defaultRoot,
  packageNames = exercisedPackageSeeds,
  timeoutMs = 120_000,
} = {}) {
  root = filesystemRoot(root);
  const coverageFailures = validateCoverageManifest(loadCoverageManifest(root), { root });
  if (coverageFailures.length > 0) throw new Error(`Coverage manifest invalid: ${coverageFailures.join(' ')}`);
  const fixtureRoot = join(root, 'tooling/testing/fixtures/duplicate-module-safety');
  const packageClosure = workspaceDependencyClosure(root, packageNames);
  const preparation = [
    await commandRecord(['pnpm', 'install', '--offline', '--frozen-lockfile'], root, timeoutMs, {
      npm_config_offline: 'true',
    }),
  ];
  for (const packageName of packageClosure) {
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
      const artifactRecords = { A: {}, B: {} };
      const artifacts = { A: {}, B: {} };
      for (const packageName of packageClosure) {
        artifactRecords.A[packageName] = await packPackage({
          commands, packedArtifacts: artifacts.A, packageName, root, sandbox, side: 'A', timeoutMs,
        });
        artifactRecords.B[packageName] = await packPackage({
          commands, packedArtifacts: artifacts.B, packageName, root, sandbox, side: 'B', timeoutMs,
        });
        artifacts.A[packageName] = artifactRecords.A[packageName].tarball;
        artifacts.B[packageName] = artifactRecords.B[packageName].tarball;
      }
      const compatibleArtifacts = { ...artifacts.B };
      compatibleArtifacts['@fluojs/core'] = await createCompatiblePatchArtifact({
        commands,
        sandbox,
        source: artifacts.B['@fluojs/core'],
        timeoutMs,
      });
      const consumerA = createConsumer({ root, sandbox, side: 'A', artifacts: artifacts.A, fixtureRoot });
      const consumerB = createConsumer({ root, sandbox, side: 'B', artifacts: artifacts.B, fixtureRoot });
      const consumerCompatible = createConsumer({
        artifacts: compatibleArtifacts,
        fixtureRoot,
        root,
        sandbox,
        side: 'C',
      });
      const [a, b] = await Promise.all([
        inspectConsumer({ root, consumerRoot: consumerA, side: 'A', timeoutMs, commands, packageClosure }),
        inspectConsumer({ root, consumerRoot: consumerB, side: 'B', timeoutMs, commands, packageClosure }),
      ]);
      const compatible = await inspectConsumer({
        root,
        consumerRoot: consumerCompatible,
        side: 'C',
        timeoutMs,
        commands,
        packageClosure,
      });
      const rootConsumer = createRootConsumer({
        consumers: { A: consumerA, B: consumerB },
        sandbox,
      });
      const simultaneous = await inspectRootConsumer({
        commands,
        consumerRoot: rootConsumer,
        root,
        timeoutMs,
        packageClosure,
      });
      for (const packageName of packageClosure) {
        const expectedA = artifactRecords.A[packageName];
        const expectedB = artifactRecords.B[packageName];
        for (const [observed, expected, side] of [
          [a, expectedA, 'A'], [b, expectedB, 'B'],
          [simultaneous.a, expectedA, 'A'], [simultaneous.b, expectedB, 'B'],
        ]) {
          const installed = observed.packages?.[packageName];
          if (installed?.package !== packageName || installed.artifact !== side
            || installed.marker !== expected.marker || installed.entrySha256 !== expected.entrySha256
            || installed.installedSha256 !== expected.entrySha256
            || !installed.realPath.includes('/node_modules/') || !installed.version) {
            throw new Error(`Installed ${packageName} ${side} does not match packed artifact: ${JSON.stringify(installed)}`);
          }
        }
        if (a.packages[packageName].realPath === b.packages[packageName].realPath
          || simultaneous.a.packages[packageName].realPath === simultaneous.b.packages[packageName].realPath) {
          throw new Error(`Installed ${packageName} A and B resolve to one physical copy.`);
        }
      }
      if (simultaneous.a.realPath === simultaneous.b.realPath
        || simultaneous.a.marker !== a.marker || simultaneous.b.marker !== b.marker) {
        throw new Error(`Private root consumer did not retain simultaneously installed wrapper A and B copies: ${JSON.stringify({
          direct: { a: a.realPath, b: b.realPath },
          root: { a: simultaneous.a.realPath, b: simultaneous.b.realPath },
        })}`);
      }
      for (const [cross, side] of [[simultaneous.cross?.aToB, 'A'], [simultaneous.cross?.bToA, 'B']]) {
        if (!cross?.error || cross.singleton !== 'singleton' || cross.request !== 'request'
          || cross.context !== `fixture-${side}` || !cross.metadata || !cross.sse
          || cross.jwt?.status !== 200 || cross.jwt.subject !== `fixture-${side}`
          || !cross.rollback?.originalPreserved || !cross.rollback.cleanupPreserved
          || cross.react?.status !== 200 || !cross.react.body.includes(`data-artifact="${side}"`)) {
          throw new Error(`Cross-copy public capabilities failed: ${JSON.stringify(cross)}`);
        }
      }
      if (a.realPath === b.realPath || a.version !== b.version || a.realPath === compatible.realPath
        || a.version === compatible.version || a.package !== '@fluojs/core' || b.package !== '@fluojs/core') {
        throw new Error('Packed consumers did not resolve distinct @fluojs/core artifacts.');
      }
      if (a.integrity !== artifactRecords.A['@fluojs/core'].entrySha256
        || b.integrity !== artifactRecords.B['@fluojs/core'].entrySha256
        || artifactRecords.A['@fluojs/core'].integrity === artifactRecords.B['@fluojs/core'].integrity
        || a.marker === b.marker
        || a.marker !== artifactRecords.A['@fluojs/core'].marker
        || b.marker !== artifactRecords.B['@fluojs/core'].marker) {
        throw new Error('Packed consumers did not retain distinct staged artifact markers and integrity.');
      }
      if (packageClosure.some((packageName) => !artifactRecords.A[packageName] || !artifactRecords.B[packageName])) {
        throw new Error('Packed fixture is missing a side-specific artifact for an exercised internal dependency.');
      }
      for (const consumer of [a, b, compatible]) {
        if (consumer.surfaces?.error?.code !== 'DUPLICATE_MODULE_SAFETY' || consumer.surfaces?.error?.recognized !== true
          || consumer.surfaces?.singleton !== true || consumer.surfaces?.requestScope !== true) {
          throw new Error(`Canonical core/DI surface validation failed for consumer ${consumer.artifact}.`);
        }
      }
      const listenerEvidence = {
        a: a.surfaces.transports,
        b: b.surfaces.transports,
      };
      for (const transport of [...listenerEvidence.a, ...listenerEvidence.b]) {
        if (transport.status !== 200 || !Number.isInteger(transport.port) || transport.port <= 0
          || transport.body?.request !== 'served-by-packed-adapter') {
          throw new Error(`Packed ${transport.kind} adapter did not return canonical listener evidence.`);
        }
      }
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
        { npm_config_offline: 'true' },
      ).then(() => null, (error) => String(error));
      if (!rejected?.includes('@fluojs/core') || !rejected.includes('999')) {
        throw new Error('Incompatible strict-peer topology did not reject the declared @fluojs/core range before runtime load.');
      }
      runs.push({
        commands,
        closure: packageClosure,
        consumers: { a, b, compatible },
        listenerEvidence,
        rootConsumer: simultaneous,
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
