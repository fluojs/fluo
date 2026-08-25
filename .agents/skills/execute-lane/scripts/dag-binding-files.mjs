import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';

import { assertContract } from '../../../workflow-contracts/contracts.mjs';

const assertRealFile = (path) => {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

export const ensureRealDirectory = (directory) => {
  if (!existsSync(directory)) {
    mkdirSync(directory);
  }
  const stat = lstatSync(directory);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(directory) !== resolve(directory)
  ) {
    throw new TypeError('DAG binding directory must be a real directory.');
  }
};

export const ensureLaneDirectory = (runtimeRoot, laneId) => {
  ensureRealDirectory(runtimeRoot);
  const directory = resolve(runtimeRoot, laneId);
  if (!directory.startsWith(`${resolve(runtimeRoot)}${sep}`)) {
    throw new TypeError('DAG binding lane path must stay under runtime root.');
  }
  ensureRealDirectory(directory);
  return directory;
};

export const loadImmutableBinding = (target) => {
  assertRealFile(target);
  if (!existsSync(target)) {
    return null;
  }
  const binding = JSON.parse(readFileSync(target, 'utf8'));
  assertContract('lane-dag-binding', binding);
  return binding;
};

export const persistImmutableBinding = (target, binding) => {
  const persisted = loadImmutableBinding(target);
  if (persisted !== null) {
    if (JSON.stringify(persisted) === JSON.stringify(binding)) {
      return;
    }
    throw new TypeError('DAG binding conflicts with the persisted run.');
  }
  const candidate = `${target}.${randomUUID()}.tmp`;
  writeFileSync(candidate, `${JSON.stringify(binding, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    try {
      linkSync(candidate, target);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      const concurrent = loadImmutableBinding(target);
      if (JSON.stringify(concurrent) !== JSON.stringify(binding)) {
        throw new TypeError('DAG binding conflicts with the persisted run.');
      }
    }
  } finally {
    if (existsSync(candidate)) {
      unlinkSync(candidate);
    }
  }
};
