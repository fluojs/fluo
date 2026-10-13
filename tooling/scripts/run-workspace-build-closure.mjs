#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireWorkspaceArtifactLeases } from './clean-dist.mjs';
import { performance } from 'node:perf_hooks';

const WORKSPACE_BUILD_LOCK_DIRECTORY = '.workspace-build-closure.lock';
const WORKSPACE_BUILD_LOCK_METADATA_FILE = 'owner.json';
const WORKSPACE_BUILD_LOCK_STALE_GRACE_MS = 5_000;

// Test writers need separate PIDs: terminating a thread cannot invalidate a
// process-owned lease. The FIFO bridge also works inside synchronous snapshots.
export function createWorkspaceArtifactWriter(artifact, rootDirectory, options = {}) {
  const lifetimeMs = options.timeoutMs ?? 10_000;
  const target = join(realpathSync(dirname(artifact)), basename(artifact));
  const key = createHash('sha256').update(target).digest('hex');
  const registry = join(realpathSync(rootDirectory), '.omo/workspace-artifact-locks', key);
  const sandbox = mkdtempSync(join(tmpdir(), 'fluo-artifact-writer-'));
  const handshake = join(sandbox, 'handshake.fifo');
  const hold = join(sandbox, 'hold.fifo');
  for (const path of [handshake, hold]) {
    const result = spawnSync('mkfifo', ['-m', '600', path], { encoding: 'utf8' });
    if (result.status !== 0) {
      rmSync(sandbox, { recursive: true, force: true });
      throw new Error(result.stderr || 'Artifact writer FIFO creation failed.');
    }
  }
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const phase = ${JSON.stringify(options.pauseAfterPublication ?? null)};
    const send = (event) => process.send(event);
    const checkpoint = (path) => {
      send('published');
      fs.writeFileSync(${JSON.stringify(handshake)}, JSON.stringify({ event: 'published', pid: process.pid, path }));
      fs.readFileSync(${JSON.stringify(hold)});
    };
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (phase === 'gate' && String(to).includes('/gate/')
        && JSON.parse(fs.readFileSync(to, 'utf8')).ticket !== null) checkpoint(String(to));
    };
    syncBuiltinESMExports();
    const { acquireWorkspaceArtifactLeases } = await import(${JSON.stringify(new URL('./clean-dist.mjs', import.meta.url).href)});
    const wait = Atomics.wait;
    let reported = false;
    Atomics.wait = (...args) => {
      if (!reported) {
        reported = true;
        send('blocked');
        fs.writeFileSync(${JSON.stringify(handshake)}, JSON.stringify({ event: 'blocked', pid: process.pid }));
      }
      return wait(...args);
    };
    process.once('message', () => {
      try {
        send('attempt');
        const lease = acquireWorkspaceArtifactLeases([${JSON.stringify(target)}], 'writer');
        try {
          if (phase === 'artifact') {
            const owner = JSON.parse(lease.environment.FLUO_WORKSPACE_ARTIFACT_WRITERS)
              .find((entry) => entry.pid === process.pid && entry.artifact === ${JSON.stringify(target)});
            checkpoint(owner.path);
          }
          fs.rmSync(${JSON.stringify(target)}, { recursive: true, force: true });
        } finally { lease.release(); }
        process.send('completed', () => process.disconnect());
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
        process.disconnect();
      }
    });
    send('ready');
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const events = [];
  child.on('message', (message) => events.push(message));
  const signal = AbortSignal.timeout(lifetimeMs);
  const exited = once(child, 'close', { signal });
  const ready = once(child, 'message', { signal }).then(([message]) => {
    if (message !== 'ready') throw new Error(`Unexpected artifact writer readiness: ${message}`);
  });
  // Cleanup may be entered after another assertion fails; the original promises
  // still reject for callers awaiting readiness or exit.
  void ready.catch(() => {});
  void exited.catch(() => {});
  return {
    child, ready, exited, events,
    attempt: () => {
      child.send('attempt-clean');
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import { readFileSync } from 'node:fs';
        process.stdout.write(readFileSync(${JSON.stringify(handshake)}));
      `], { encoding: 'utf8', timeout: 10_000 });
      if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Artifact writer handshake failed.');
      const observed = JSON.parse(result.stdout);
      if (observed.pid !== child.pid || observed.event !== (options.pauseAfterPublication ? 'published' : 'blocked')) {
        throw new Error(`Unexpected artifact writer handshake: ${result.stdout}`);
      }
      return observed;
    },
    stop: async () => {
      const running = child.exitCode === null && child.signalCode === null;
      const closed = running ? once(child, 'close', { signal: AbortSignal.timeout(10_000) }) : exited;
      if (running) child.kill('SIGKILL');
      try {
        await closed;
      } finally {
        // Never remove the shared gate or entries belonging to a live process.
        if (child.pid && !isProcessAlive(child.pid)) {
          for (const directory of [registry, join(registry, 'gate')]) {
            if (!existsSync(directory)) continue;
            for (const token of readdirSync(directory).filter((entry) => entry.startsWith(`${child.pid}-`))) {
              rmSync(join(directory, token), { force: true });
            }
          }
        }
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  };
}

function getWorkspaceBuildLockMetadataPath(lockDirectory) {
  return join(lockDirectory, WORKSPACE_BUILD_LOCK_METADATA_FILE);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }

    return true;
  }
}

function shouldRecoverWorkspaceBuildLock(lockDirectory) {
  const metadataPath = getWorkspaceBuildLockMetadataPath(lockDirectory);

  if (existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      if (typeof metadata.pid === 'number') {
        return !isProcessAlive(metadata.pid);
      }
    } catch {
      return true;
    }
  }

  try {
    const ageMs = Date.now() - statSync(lockDirectory).mtimeMs;
    return ageMs >= WORKSPACE_BUILD_LOCK_STALE_GRACE_MS;
  } catch {
    return true;
  }
}

function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const execPath = process.env.npm_execpath ?? '';

  if (userAgent.startsWith('pnpm/') || execPath.includes('pnpm')) {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  }

  if (userAgent.startsWith('yarn/') || execPath.includes('yarn')) {
    return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  }

  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function readWorkspaceGlobs(rootDirectory) {
  const pnpmWorkspacePath = join(rootDirectory, 'pnpm-workspace.yaml');

  if (existsSync(pnpmWorkspacePath)) {
    const content = readFileSync(pnpmWorkspacePath, 'utf8');
    const matches = [...content.matchAll(/^\s+-\s+['"]?([^'"#\n]+?)['"]?\s*$/gm)];

    if (matches.length > 0) {
      return matches.map((match) => match[1].trim());
    }
  }

  const packageJsonPath = join(rootDirectory, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Workspace root package.json was not found at ${packageJsonPath}.`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (!Array.isArray(packageJson.workspaces)) {
    throw new Error('Could not find workspace definitions in pnpm-workspace.yaml or package.json workspaces.');
  }

  return packageJson.workspaces;
}

function collectWorkspaceManifests(rootDirectory) {
  const manifests = [];

  for (const workspace of readWorkspaceGlobs(rootDirectory)) {
    const [segment] = workspace.split('/');
    const workspaceDirectory = join(rootDirectory, segment);

    if (!existsSync(workspaceDirectory)) {
      continue;
    }

    for (const entry of readdirSync(workspaceDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = join(workspaceDirectory, entry.name);
      const manifestPath = join(candidate, 'package.json');
      if (!existsSync(manifestPath)) {
        continue;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
        continue;
      }

      manifests.push({
        directory: candidate,
        manifest,
        name: manifest.name,
      });
    }
  }

  return manifests;
}

function isWorkspaceDependency(dependencyName, dependencyVersion, manifestByName) {
  return manifestByName.has(dependencyName)
    && typeof dependencyVersion === 'string'
    && (dependencyVersion.startsWith('workspace:') || dependencyVersion === 'catalog:');
}

function collectLocalDependencies(manifest, manifestByName, includeDeclarationDevDependencies) {
  const sections = [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies];

  const dependencies = new Set();
  for (const section of sections) {
    if (!section || typeof section !== 'object') {
      continue;
    }

    for (const [dependencyName, dependencyVersion] of Object.entries(section)) {
      if (isWorkspaceDependency(dependencyName, dependencyVersion, manifestByName)) {
        dependencies.add(dependencyName);
      }
    }
  }

  if (includeDeclarationDevDependencies) {
    const declarationBuildDevDependencies = manifest.fluo?.declarationBuildDevDependencies;
    for (const dependencyName of Array.isArray(declarationBuildDevDependencies) ? declarationBuildDevDependencies : []) {
      const dependencyVersion = manifest.devDependencies?.[dependencyName];
      const dependency = manifestByName.get(dependencyName);
      if (
        dependency
        && typeof dependency.manifest.types === 'string'
        && isWorkspaceDependency(dependencyName, dependencyVersion, manifestByName)
      ) {
        dependencies.add(dependencyName);
      }
    }
  }

  return [...dependencies].sort((left, right) => left.localeCompare(right));
}

export function resolveWorkspaceBuildOrder(targetPackageName, rootDirectory) {
  const workspaceManifests = collectWorkspaceManifests(rootDirectory);
  const manifestByName = new Map(workspaceManifests.map((entry) => [entry.name, entry]));

  if (!manifestByName.has(targetPackageName)) {
    throw new Error(`Could not find workspace package ${targetPackageName}.`);
  }

  const visiting = new Set();
  const visited = new Set();
  const order = [];

  function visit(packageName, includeDeclarationDevDependencies = false) {
    if (visited.has(packageName)) {
      return;
    }

    if (visiting.has(packageName)) {
      throw new Error(`Detected a workspace dependency cycle involving ${packageName}.`);
    }

    const entry = manifestByName.get(packageName);
    if (!entry) {
      throw new Error(`Workspace package ${packageName} is missing from manifest map.`);
    }

    visiting.add(packageName);
    for (const dependencyName of collectLocalDependencies(entry.manifest, manifestByName, includeDeclarationDevDependencies)) {
      visit(dependencyName);
    }
    visiting.delete(packageName);
    visited.add(packageName);
    order.push(packageName);
  }

  visit(targetPackageName, true);
  return order;
}

export function runWorkspaceBuildClosure(targetPackageName, rootDirectory, options = {}) {
  const deadline = options.timeoutMs === undefined ? undefined : performance.now() + options.timeoutMs;
  const packageManager = options.packageManager ?? detectPackageManager();
  const stdio = options.stdio ?? 'pipe';
  const order = resolveWorkspaceBuildOrder(targetPackageName, rootDirectory);
  const workspaceManifests = collectWorkspaceManifests(rootDirectory);
  const manifestByName = new Map(workspaceManifests.map((entry) => [entry.name, entry]));
  // An old crashed closure may have left the former workspace-wide lock.
  // Recover it without reintroducing global serialization for independent artifacts.
  const oldLock = join(rootDirectory, WORKSPACE_BUILD_LOCK_DIRECTORY);
  if (existsSync(oldLock) && shouldRecoverWorkspaceBuildLock(oldLock)) {
    rmSync(oldLock, { force: true, recursive: true });
  }
  // Reserve only overlapping builders in a stable artifact order. Reader leases
  // remain compatible until each package actually starts emitting its output.
  const buildLease = acquireWorkspaceArtifactLeases(
    order.map((name) => join(manifestByName.get(name).directory, 'dist')), 'builder', deadline,
  );
  const leases = [buildLease];

  let stdout = '';
  let stderr = '';

  try {
    for (const packageName of order) {
      const entry = manifestByName.get(packageName);
      if (!entry || typeof entry.manifest.scripts?.build !== 'string') {
        continue;
      }

      const artifact = join(realpathSync(entry.directory), 'dist');
      buildLease.activate(artifact);
      const args = packageManager.startsWith('npm') ? ['run', 'build'] : ['run', 'build'];
      const result = spawnSync(packageManager, args, {
        cwd: entry.directory,
        encoding: 'utf8',
        stdio,
        env: buildLease.environment,
        timeout: deadline === undefined ? undefined : Math.max(1, Math.ceil(deadline - performance.now())),
      });

      if (stdio === 'pipe') {
        stdout += `\n[build:${packageName}]\n${result.stdout ?? ''}`;
        stderr += `\n[build:${packageName}]\n${result.stderr ?? ''}`;
      }

      if (result.error) {
        throw result.error;
      }

      if (result.signal) {
        stderr = `${stderr}\nBuild for ${packageName} terminated by signal ${result.signal}.`.trim();
        return {
          order,
          packageManager,
          status: 1,
          stderr,
          stdout: stdout.trim(),
        };
      }

      if (typeof result.status !== 'number') {
        stderr = `${stderr}\nBuild for ${packageName} exited without a numeric status.`.trim();
        return {
          order,
          packageManager,
          status: 1,
          stderr,
          stdout: stdout.trim(),
        };
      }

      if (result.status !== 0) {
        return {
          order,
          packageManager,
          status: result.status,
          stderr: stderr.trim(),
          stdout: stdout.trim(),
        };
      }
      // Keep the emitted declarations readable through later builds and packing,
      // but do not keep a writer on artifacts this closure has finished writing.
      buildLease.downgrade(artifact);
    }

    buildLease.downgrade();
    const snapshotPackages = new Set(
      (options.snapshotPackages ?? []).flatMap((name) => resolveWorkspaceBuildOrder(name, rootDirectory)),
    );
    leases.push(acquireWorkspaceArtifactLeases(
      [...snapshotPackages].filter((name) => !order.includes(name))
        .map((name) => join(manifestByName.get(name).directory, 'dist')),
      'reader', deadline,
    ));
    const result = {
      order,
      packageManager,
      status: 0,
      stderr: stderr.trim(),
      stdout: stdout.trim(),
    };
    if (options.consume?.(result) instanceof Promise) {
      throw new TypeError('Workspace build consumption must be synchronous.');
    }
    return result;
  } finally {
    for (const lease of leases.reverse()) lease.release();
  }
}

export function withWorkspaceArtifactSnapshot(packageNames, rootDirectory, consume) {
  const names = new Set(packageNames.flatMap((name) => resolveWorkspaceBuildOrder(name, rootDirectory)));
  const manifests = new Map(collectWorkspaceManifests(rootDirectory).map((entry) => [entry.name, entry]));
  const lease = acquireWorkspaceArtifactLeases(
    [...names].map((name) => join(manifests.get(name).directory, 'dist')),
    'reader',
  );
  try {
    const result = consume();
    if (result instanceof Promise) return result.finally(lease.release);
    lease.release();
    return result;
  } catch (error) {
    lease.release();
    throw error;
  }
}

function main() {
  const [targetPackageName] = process.argv.slice(2);
  if (!targetPackageName) {
    throw new Error('Usage: node ./tooling/scripts/run-workspace-build-closure.mjs <workspace-package-name>');
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const rootDirectory = resolve(scriptDirectory, '..', '..');
  const result = runWorkspaceBuildClosure(targetPackageName, rootDirectory, { stdio: 'inherit' });

  if (result.status !== 0) {
    process.exit(result.status);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
