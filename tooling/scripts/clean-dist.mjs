#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const timeoutMs = 300_000;
const staleGraceMs = 5_000;
const inheritedLeaseVariable = 'FLUO_WORKSPACE_ARTIFACT_WRITERS';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

function stale(path) {
  try {
    const owner = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof owner.pid === 'number') return !alive(owner.pid);
  } catch (error) {
    if (error?.code !== 'ENOENT') return true;
  }
  try {
    return Date.now() - statSync(dirname(path)).mtimeMs >= staleGraceMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

function wait(deadline, directory) {
  if (performance.now() >= deadline) throw new Error(`Timed out waiting for workspace artifact lock at ${directory}.`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}

function gateOwners(gate) {
  const owners = [];
  for (const token of readdirSync(gate)) {
    const path = join(gate, token);
    if (token.endsWith('.pending')) {
      const pid = Number(token.match(/^([1-9][0-9]*)-/u)?.[1]);
      if (Number.isSafeInteger(pid) && !alive(pid)) rmSync(path, { force: true });
      continue;
    }
    if (!token.endsWith('.json')) continue;
    let owner;
    try {
      owner = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) {
      throw new Error(`Invalid workspace artifact gate owner at ${path}.`);
    }
    if (!alive(owner.pid)) {
      // Each new owner has a unique path. A late recoverer can remove only the
      // dead owner's entry, never a replacement owner's entry or gate directory.
      rmSync(path, { force: true });
      continue;
    }
    const ticket = token === 'owner.json' ? 0 : owner.ticket;
    if (ticket !== null && (!Number.isSafeInteger(ticket) || ticket < 0)) {
      throw new Error(`Invalid workspace artifact gate ticket at ${path}.`);
    }
    owners.push({ token, ticket });
  }
  return owners;
}

function guarded(directory, callback, deadline = performance.now() + timeoutMs) {
  const gate = join(directory, 'gate');
  mkdirSync(gate, { recursive: true });
  const token = `${process.pid}-${randomUUID()}.json`;
  const path = join(gate, token);
  const pending = `${path}.pending`;
  const publish = (ticket) => {
    writeFileSync(pending, JSON.stringify({ pid: process.pid, ticket }));
    renameSync(pending, path);
  };
  try {
    gateOwners(gate);
    // A per-artifact bakery queue makes selection visible before choosing a
    // ticket. Atomic replacement keeps even staged/empty writes private.
    publish(null);
    const ticket = 1 + Math.max(0, ...gateOwners(gate).map((owner) => owner.ticket ?? 0));
    publish(ticket);
    while (gateOwners(gate).some((owner) => owner.token !== token && (
      owner.ticket === null || owner.ticket < ticket
      || (owner.ticket === ticket && owner.token < token)
    ))) {
      wait(deadline, gate);
    }
    return callback();
  } finally {
    rmSync(pending, { force: true });
    rmSync(path, { force: true });
  }
}

function workspaceRoot(artifact) {
  let directory = dirname(artifact);
  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest) && Array.isArray(JSON.parse(readFileSync(manifest, 'utf8')).workspaces)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return fileURLToPath(new URL('../../', import.meta.url));
    directory = parent;
  }
}

// This file stays self-contained: release fixtures also copy clean-dist without
// the closure builder. Locks live outside dist, which the writer removes.
export function acquireWorkspaceArtifactLeases(paths, mode, deadline = performance.now() + timeoutMs) {
  const inherited = JSON.parse(process.env[inheritedLeaseVariable] ?? '[]');
  const leases = [];
  const release = () => {
    for (const lease of leases.splice(0).reverse()) {
      guarded(lease.directory, () => rmSync(lease.path, { force: true }));
    }
  };
  try {
    for (const artifact of [...new Set(paths.map((path) => join(realpathSync(dirname(path)), path.split(/[\\/]/u).at(-1))))].sort()) {
      const key = createHash('sha256').update(artifact).digest('hex');
      const directory = join(workspaceRoot(artifact), '.omo/workspace-artifact-locks', key);
      mkdirSync(directory, { recursive: true });
      const owned = inherited.find((lease) => lease.artifact === artifact
        && lease.directory === directory && alive(lease.pid)
        && existsSync(join(directory, lease.token)));
      if (owned) {
        const metadata = JSON.parse(readFileSync(join(directory, owned.token), 'utf8'));
        if (metadata.pid === owned.pid && metadata.mode === 'writer') continue;
      }
      const token = `${process.pid}-${randomUUID()}.json`;
      const path = join(directory, token);
      while (true) {
        const acquired = guarded(directory, () => {
          const owners = [];
          for (const entry of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
            const ownerPath = join(directory, entry);
            if (stale(ownerPath)) {
              rmSync(ownerPath, { force: true });
            } else {
              owners.push(JSON.parse(readFileSync(ownerPath, 'utf8')));
            }
          }
          if (owners.some((owner) => mode === 'writer' || owner.mode === 'writer'
            || (mode === 'builder' && owner.mode === 'builder'))) return false;
          writeFileSync(path, JSON.stringify({ pid: process.pid, mode }));
          return true;
        }, deadline);
        if (acquired) break;
        wait(deadline, directory);
      }
      leases.push({ artifact, directory, token, path, pid: process.pid });
    }
    return {
      release,
      activate: (artifact) => {
        const lease = leases.find((entry) => entry.artifact === artifact);
        while (true) {
          const activated = guarded(lease.directory, () => {
            for (const entry of readdirSync(lease.directory).filter((name) => name.endsWith('.json') && name !== lease.token)) {
              const ownerPath = join(lease.directory, entry);
              if (stale(ownerPath)) rmSync(ownerPath, { force: true });
              else return false;
            }
            writeFileSync(lease.path, JSON.stringify({ pid: process.pid, mode: 'writer' }));
            return true;
          }, deadline);
          if (activated) return;
          wait(deadline, lease.directory);
        }
      },
      downgrade: (artifact) => {
        for (const lease of leases.filter((entry) => artifact === undefined || entry.artifact === artifact)) {
          guarded(lease.directory, () => {
            writeFileSync(lease.path, JSON.stringify({ pid: process.pid, mode: 'reader' }));
          });
        }
      },
      environment: {
        ...process.env,
        [inheritedLeaseVariable]: JSON.stringify([
          ...inherited,
          ...(mode === 'writer' || mode === 'builder' ? leases : []),
        ]),
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolve(process.cwd(), process.argv[2] ?? 'dist');
  const lease = acquireWorkspaceArtifactLeases([target], 'writer');
  try {
    rmSync(target, { force: true, recursive: true });
  } finally {
    lease.release();
  }
}
