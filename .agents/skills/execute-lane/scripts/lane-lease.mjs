import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
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

export const acquireLease = (stateDirectory, laneId) => {
  const lockPath = resolve(stateDirectory, 'lease.lock');
  const descriptor = openSync(lockPath, 'wx');
  const token = randomUUID();
  const leasePath = resolve(stateDirectory, 'lease.json');
  writeAtomic(leasePath, {
    version: 1,
    lane_id: laneId,
    holder: `execute-lane:${token}`,
    status: 'active',
  });
  return {
    release(outcome) {
      closeSync(descriptor);
      unlinkSync(lockPath);
      writeAtomic(leasePath, {
        version: 1,
        lane_id: laneId,
        holder: `execute-lane:${token}`,
        status: 'released',
        outcome,
      });
    },
  };
};
