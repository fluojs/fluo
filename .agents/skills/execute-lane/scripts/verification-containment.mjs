import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const processRows = () => {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  return output.trim().split('\n').filter(Boolean).map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    return match === null ? null : {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4],
    };
  }).filter(Boolean);
};

const descendantsOf = (rootPid, known = new Set()) => {
  const rows = processRows();
  const descendants = new Set(known);
  descendants.add(rootPid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  descendants.delete(rootPid);
  return descendants;
};

const signalProcesses = (pids, signal) => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
};

const processExists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const signalProcessGroup = (rootPid, signal) => {
  try {
    process.kill(-rootPid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
};

const terminateDescendants = async (rootPid, known) => {
  let targets = descendantsOf(rootPid, known);
  signalProcesses(targets, 'SIGTERM');
  const deadline = Date.now() + 2_000;
  while ([...targets].some(processExists) && Date.now() < deadline) {
    await sleep(20);
    targets = descendantsOf(rootPid, targets);
  }
  signalProcesses([...targets].filter(processExists), 'SIGKILL');
  await sleep(20);
  if ([...targets].some(processExists)) {
    throw new TypeError('verification containment could not terminate every observed descendant.');
  }
};

const quoteProfilePath = (path) => path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

const verificationCommand = (phase, storePath) => phase === 'install'
  ? ['pnpm', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', storePath, '--config.enableGlobalVirtualStore=false', '--ignore-pnpmfile', '--virtual-store-dir', '.pnpm']
  : phase === 'verify'
    ? ['pnpm', 'verify']
    : (() => { throw new TypeError('canonical verification containment phase is invalid.'); })();

const darwinCommand = (disposableRoot, runtimeRoot, storePath, phase) => {
  if (!existsSync('/usr/bin/sandbox-exec')) {
    throw new TypeError('canonical verification containment is unsupported: sandbox-exec is unavailable.');
  }
  const profilePath = resolve(runtimeRoot, 'verify.sb');
  const profile = `(version 1)\n(deny default)\n(allow process-fork)\n(allow process-exec)\n(allow signal (target self))\n(allow signal (target children))\n(allow file-read*)\n(allow sysctl-read)\n(allow mach-lookup)\n(allow file-write*\n  (subpath "${quoteProfilePath(disposableRoot)}")\n  (subpath "${quoteProfilePath(runtimeRoot)}")\n  (literal "/dev/null"))\n`;
  writeFileSync(profilePath, profile, { encoding: 'utf8', flag: 'wx' });
  const [command, ...args] = verificationCommand(phase, storePath);
  return ['/usr/bin/sandbox-exec', ['-f', profilePath, command, ...args]];
};

const linuxCommand = (disposableRoot, runtimeRoot, storePath, phase) => {
  const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find(existsSync);
  if (bwrap === undefined) {
    throw new TypeError('canonical verification containment is unsupported: no trusted Linux PID-namespace backend is available.');
  }
  const [command, ...args] = verificationCommand(phase, storePath);
  return [bwrap, [
    '--die-with-parent', '--new-session', '--unshare-pid', '--unshare-net',
    '--ro-bind', '/', '/', '--ro-bind', storePath, storePath,
    '--bind', disposableRoot, disposableRoot,
    '--bind', runtimeRoot, runtimeRoot, '--chdir', disposableRoot,
    '--setenv', 'HOME', runtimeRoot, '--setenv', 'TMPDIR', runtimeRoot,
    command, ...args,
  ]];
};

const requireTrustedInputs = (disposableRoot, runtimeRoot, storePath, lockfileSha256) => {
  for (const [path, name] of [
    [disposableRoot, 'disposable root'],
    [runtimeRoot, 'runtime root'],
    [storePath, 'pnpm store'],
  ]) {
    if (typeof path !== 'string' || path !== resolve(path)) {
      throw new TypeError(`canonical verification ${name} must be absolute and canonical.`);
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== path) {
      throw new TypeError(`canonical verification ${name} must be a real directory.`);
    }
  }
  const lockfilePath = resolve(disposableRoot, 'pnpm-lock.yaml');
  const lockfileStat = lstatSync(lockfilePath);
  const actual = lockfileStat.isSymbolicLink() || !lockfileStat.isFile()
    ? null
    : createHash('sha256').update(readFileSync(lockfilePath)).digest('hex');
  if (!/^[a-f0-9]{64}$/u.test(lockfileSha256 ?? '') || actual !== lockfileSha256) {
    throw new TypeError('canonical verification lockfile integrity binding failed.');
  }
};

export const runContainedVerification = async ({
  disposable_root: disposableRoot,
  runtime_root: runtimeRoot,
  phase,
  pnpm_store_path: storePath,
  lockfile_sha256: lockfileSha256,
}) => {
  requireTrustedInputs(disposableRoot, runtimeRoot, storePath, lockfileSha256);
  const backend = platform() === 'darwin'
    ? darwinCommand(disposableRoot, runtimeRoot, storePath, phase)
    : platform() === 'linux'
      ? linuxCommand(disposableRoot, runtimeRoot, storePath, phase)
      : (() => { throw new TypeError(`canonical verification containment is unsupported on ${platform()}.`); })();
  const [command, args] = backend;
  const child = spawn(command, args, {
    cwd: disposableRoot,
    detached: true,
    env: {
      ...process.env,
      CI: 'true',
      HOME: runtimeRoot,
      TMPDIR: runtimeRoot,
      XDG_CACHE_HOME: resolve(runtimeRoot, 'cache'),
      XDG_CONFIG_HOME: resolve(runtimeRoot, 'config'),
      XDG_DATA_HOME: resolve(runtimeRoot, 'data'),
      NPM_CONFIG_USERCONFIG: resolve(runtimeRoot, 'empty-npmrc'),
      PNPM_HOME: process.env.PNPM_HOME,
    },
    shell: false,
    stdio: 'inherit',
  });
  const observed = new Set();
  const sampler = setInterval(() => {
    try {
      for (const pid of descendantsOf(child.pid)) observed.add(pid);
    } catch {
      // Final fail-closed cleanup performs a fresh process-table check.
    }
  }, 10);
  let outcome;
  let interruptedSignal = null;
  const interrupt = (signal) => {
    interruptedSignal ??= signal;
    try { process.kill(-child.pid, signal); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
  };
  const onSigint = () => interrupt('SIGINT');
  const onSigterm = () => interrupt('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    outcome = await new Promise((resolvePromise, reject) => {
      child.once('error', reject);
      child.once('exit', (status, signal) => resolvePromise({ status, signal }));
    });
  } finally {
    clearInterval(sampler);
    signalProcessGroup(child.pid, 'SIGTERM');
    await terminateDescendants(child.pid, observed);
    signalProcessGroup(child.pid, 'SIGKILL');
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
  requireTrustedInputs(disposableRoot, runtimeRoot, storePath, lockfileSha256);
  return interruptedSignal === null ? outcome : { status: null, signal: interruptedSignal };
};

const isCli = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  const requestPath = process.argv[2];
  if (requestPath === undefined) throw new TypeError('verification containment request is required.');
  const request = JSON.parse(readFileSync(requestPath, 'utf8'));
  const outcome = await runContainedVerification(request);
  if (outcome.signal !== null) {
    process.kill(process.pid, outcome.signal);
  }
  process.exitCode = outcome.status ?? 1;
}
