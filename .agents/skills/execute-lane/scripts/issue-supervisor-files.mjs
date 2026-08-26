import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';

import { requirePositiveInteger } from './issue-supervisor-contracts.mjs';

export const assertRealFile = (path) => {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

const ensureDirectory = (path) => {
  if (!existsSync(path)) {
    mkdirSync(path);
  }
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(path) !== resolve(path)
  ) {
    throw new TypeError(`${path} must be a real directory.`);
  }
};

export const issueDirectory = (runtimeRoot, laneId, issueNumber) => {
  if (
    !/^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(laneId)
  ) {
    throw new TypeError('issue supervisor lane ID is not canonical.');
  }
  requirePositiveInteger(issueNumber, 'issue supervisor store issue number');
  ensureDirectory(runtimeRoot);
  const laneDirectory = resolve(runtimeRoot, laneId);
  if (!laneDirectory.startsWith(`${resolve(runtimeRoot)}${sep}`)) {
    throw new TypeError('issue supervisor lane path escaped runtime root.');
  }
  ensureDirectory(laneDirectory);
  const issuesDirectory = resolve(laneDirectory, 'issues');
  ensureDirectory(issuesDirectory);
  const directory = resolve(issuesDirectory, String(issueNumber));
  if (!directory.startsWith(`${realpathSync(issuesDirectory)}${sep}`)) {
    throw new TypeError('issue supervisor path escaped the issues directory.');
  }
  ensureDirectory(directory);
  return directory;
};

const defaultProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const defaultProcessIdentity = (pid) => {
  if (!defaultProcessAlive(pid)) return null;
  try {
    const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    }).trim();
    return start.length === 0 ? null : start;
  } catch {
    return null;
  }
};

const issueLeaseOwner = (lockPath) => {
  const lockStat = lstatSync(lockPath);
  const ownerPath = resolve(lockPath, 'owner.json');
  const ownerStat = lstatSync(ownerPath);
  if (lockStat.isSymbolicLink() || !lockStat.isDirectory() ||
      ownerStat.isSymbolicLink() || !ownerStat.isFile()) {
    throw new TypeError('issue supervisor store lease metadata is malformed.');
  }
  let owner;
  try {
    owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  } catch {
    throw new TypeError('issue supervisor store lease metadata is malformed.');
  }
  if (
    owner?.version !== 1 ||
    typeof owner.token !== 'string' || !/^[a-f0-9-]{36}$/u.test(owner.token) ||
    !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
    typeof owner.process_start !== 'string' || owner.process_start.length === 0 ||
    !Number.isSafeInteger(owner.heartbeat_ms) || owner.heartbeat_ms < 0
  ) {
    throw new TypeError('issue supervisor store lease metadata is invalid.');
  }
  return owner;
};

const retireIssueLease = (lease, token) => {
  if (!existsSync(lease.lock_path)) return false;
  let owner;
  try {
    owner = issueLeaseOwner(lease.lock_path);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (owner.token !== token) return false;
  try {
    renameSync(lease.lock_path, resolve(lease.directory, `lease.retired-${token}`));
    return true;
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) return false;
    throw error;
  }
};

export const acquireIssueSupervisorLease = (directory, options = {}) => {
  const canonicalDirectory = resolve(directory);
  ensureDirectory(canonicalDirectory);
  const processIdentity = options.process_identity ?? defaultProcessIdentity;
  const processAlive = options.process_alive ?? defaultProcessAlive;
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const staleAfterMs = options.stale_after_ms ?? 30_000;
  if (typeof processIdentity !== 'function' || typeof processAlive !== 'function' || typeof now !== 'function' ||
      !Number.isSafeInteger(pid) || pid <= 0 ||
      !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) {
    throw new TypeError('issue supervisor store lease process identity is invalid.');
  }
  const processStart = processIdentity(pid);
  if (typeof processStart !== 'string' || processStart.length === 0) {
    throw new TypeError('issue supervisor store lease cannot identify its owner process.');
  }
  const token = randomUUID();
  const lockPath = resolve(canonicalDirectory, 'lease.lock');
  if (existsSync(lockPath) && !lstatSync(lockPath).isDirectory()) {
    throw new TypeError('issue supervisor store lease is already held.');
  }
  const candidatePath = resolve(canonicalDirectory, `lease.candidate-${token}`);
  mkdirSync(candidatePath);
  writeFileSync(resolve(candidatePath, 'owner.json'), `${JSON.stringify({
    version: 1,
    token,
    pid,
    process_start: processStart,
    heartbeat_ms: now(),
  })}\n`, { encoding: 'utf8', flag: 'wx' });
  const lease = { token, pid, process_start: processStart, lock_path: lockPath,
    directory: canonicalDirectory, process_identity: processIdentity, now, stale_after_ms: staleAfterMs };
  try {
    for (;;) {
      try {
        renameSync(candidatePath, lockPath);
        return lease;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error;
      }
      let owner;
      try {
        owner = issueLeaseOwner(lockPath);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const observedIdentity = processIdentity(owner.pid);
      if (
        observedIdentity === owner.process_start ||
        (observedIdentity === null && processAlive(owner.pid))
      ) {
        throw new TypeError('issue supervisor store lease is already held.');
      }
      // A different non-null start fingerprint proves PID reuse. A null
      // fingerprint permits takeover only when the PID is proven dead; age
      // never substitutes for process identity.
      retireIssueLease(lease, owner.token);
    }
  } finally {
    if (existsSync(candidatePath)) rmSync(candidatePath, { recursive: true });
  }
};

export const heartbeatIssueSupervisorLease = (lease) => {
  const owner = issueLeaseOwner(lease.lock_path);
  if (owner.token !== lease.token || owner.pid !== lease.pid ||
      owner.process_start !== lease.process_start) return false;
  atomicWrite(resolve(lease.lock_path, 'owner.json'), `${JSON.stringify({
    ...owner,
    heartbeat_ms: lease.now(),
  })}\n`);
  return true;
};

export const releaseIssueSupervisorLease = (lease) =>
  retireIssueLease(lease, lease.token);

export const withIssueLease = (directory, operation, options = {}) => {
  if (typeof operation !== 'function') {
    throw new TypeError('issue supervisor store lease operation is invalid.');
  }
  const lease = acquireIssueSupervisorLease(directory, options);
  try {
    heartbeatIssueSupervisorLease(lease);
    const result = operation(lease);
    heartbeatIssueSupervisorLease(lease);
    return result;
  } finally {
    releaseIssueSupervisorLease(lease);
  }
};

export const atomicWrite = (path, value) => {
  assertRealFile(path);
  const candidate = `${path}.${randomUUID()}.tmp`;
  writeFileSync(candidate, value, { encoding: 'utf8', flag: 'wx' });
  try {
    renameSync(candidate, path);
  } finally {
    if (existsSync(candidate)) {
      unlinkSync(candidate);
    }
  }
};
