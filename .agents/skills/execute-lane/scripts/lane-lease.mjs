import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const assertRegularFile = (path) => {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

const writeAtomic = (path, value) => {
  assertRegularFile(path);
  const candidate = `${path}.${randomUUID()}.tmp`;
  writeFileSync(candidate, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    renameSync(candidate, path);
  } finally {
    if (existsSync(candidate)) {
      unlinkSync(candidate);
    }
  }
};

const readOwner = (leasePath) => {
  assertRegularFile(leasePath);
  const owner = JSON.parse(readFileSync(leasePath, 'utf8'));
  if (
    owner?.version !== 2 ||
    owner.status !== 'active' ||
    typeof owner.token !== 'string' ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.process_start !== 'string' ||
    owner.process_start.length === 0
  ) {
    throw new TypeError('execute-lane parent lease owner is invalid.');
  }
  return owner;
};

const defaultProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const defaultProcessIdentity = (pid) => {
  try {
    const start = execFileSync(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      { encoding: 'utf8', timeout: 5_000 },
    ).trim();
    return start.length === 0 ? null : start;
  } catch {
    return null;
  }
};

export const acquireLease = (
  stateDirectory,
  laneId,
  options = {},
) => {
  const lockPath = resolve(stateDirectory, 'lease.lock');
  const processIdentity =
    options.process_identity ?? defaultProcessIdentity;
  const processAlive = options.process_alive ?? defaultProcessAlive;
  const pid = options.pid ?? process.pid;
  if (
    typeof processIdentity !== 'function' ||
    typeof processAlive !== 'function' ||
    !Number.isSafeInteger(pid) ||
    pid <= 0
  ) {
    throw new TypeError(
      'execute-lane parent lease process identity is invalid.',
    );
  }
  const processStart = processIdentity(pid);
  if (typeof processStart !== 'string' || processStart.length === 0) {
    throw new TypeError(
      'execute-lane parent lease cannot identify its owner process.',
    );
  }
  const token = randomUUID();
  const leasePath = resolve(stateDirectory, 'lease.json');
  let descriptor;
  for (;;) {
    try {
      descriptor = openSync(lockPath, 'wx');
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      const owner = readOwner(leasePath);
      const observedIdentity = processIdentity(owner.pid);
      if (
        observedIdentity === owner.process_start ||
        (observedIdentity === null && processAlive(owner.pid))
      ) {
        throw new TypeError(
          'execute-lane parent lease is already held.',
        );
      }
      unlinkSync(lockPath);
    }
  }
  try {
    writeAtomic(leasePath, {
      version: 2,
      lane_id: laneId,
      holder: `execute-lane:${token}`,
      token,
      pid,
      process_start: processStart,
      status: 'active',
    });
  } catch (error) {
    closeSync(descriptor);
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
    throw error;
  }
  return {
    release(outcome) {
      const owner = readOwner(leasePath);
      if (owner.token !== token) {
        closeSync(descriptor);
        return false;
      }
      writeAtomic(leasePath, {
        ...owner,
        lane_id: laneId,
        holder: `execute-lane:${token}`,
        status: 'released',
        outcome,
      });
      closeSync(descriptor);
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
      return true;
    },
  };
};
