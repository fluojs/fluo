import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
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

export const withIssueLease = (directory, operation) => {
  const leasePath = resolve(directory, 'lease.lock');
  let descriptor;
  try {
    descriptor = openSync(leasePath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new TypeError('issue supervisor store lease is already held.');
    }
    throw error;
  }
  try {
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(leasePath);
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
