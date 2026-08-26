import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const requireRealDirectory = (path, create = false) => {
  if (!existsSync(path)) {
    if (!create) {
      throw new TypeError(`${path} must exist.`);
    }
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

const canonicalRepositoryRoot = (repositoryRoot) => {
  if (
    typeof repositoryRoot !== 'string' ||
    repositoryRoot.length === 0
  ) {
    throw new TypeError('repository_root must be a nonempty path.');
  }
  const requestedRoot = resolve(repositoryRoot);
  requireRealDirectory(requestedRoot);
  return realpathSync(requestedRoot);
};

export const canonicalLaneLedgerPath = (
  repositoryRoot,
  requestedLedgerPath,
) => {
  if (
    typeof requestedLedgerPath !== 'string' ||
    requestedLedgerPath.length === 0
  ) {
    throw new TypeError(
      'ledger_path must be a nonempty canonical lane ledger path.',
    );
  }
  const canonicalRoot = canonicalRepositoryRoot(repositoryRoot);
  const ledgerDirectory = resolve(canonicalRoot, '.omo', 'lanes');
  const ledgerPath = resolve(canonicalRoot, requestedLedgerPath);
  const laneId = basename(ledgerPath, '.json');
  if (
    dirname(ledgerPath) !== ledgerDirectory ||
    basename(ledgerPath) !== `${laneId}.json` ||
    !/^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(laneId)
  ) {
    throw new TypeError(
      'ledger_path must be an existing canonical lane ledger path.',
    );
  }
  requireRealDirectory(ledgerDirectory);
  if (!existsSync(ledgerPath)) {
    throw new TypeError(
      'ledger_path must be an existing canonical lane ledger path.',
    );
  }
  const stat = lstatSync(ledgerPath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    realpathSync(ledgerPath) !== ledgerPath
  ) {
    throw new TypeError('ledger_path must be a real canonical lane ledger.');
  }
  return { repositoryRoot: canonicalRoot, laneId, ledgerPath };
};

export const canonicalLaneRuntimeRoot = (repositoryRoot) => {
  const canonicalRoot = canonicalRepositoryRoot(repositoryRoot);
  const omoDirectory = resolve(canonicalRoot, '.omo');
  const runtimeRoot = resolve(omoDirectory, 'lane-runs');
  requireRealDirectory(omoDirectory, true);
  requireRealDirectory(runtimeRoot, true);
  return runtimeRoot;
};

export const canonicalNativeDagRunPath = (
  repositoryRoot,
  runId,
) => {
  if (
    typeof runId !== 'string' ||
    !/^dag_[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(runId)
  ) {
    throw new TypeError('run_id must be a canonical native DAG run ID.');
  }
  const canonicalRoot = canonicalRepositoryRoot(repositoryRoot);
  const runDirectory = resolve(
    canonicalRoot,
    '.omo',
    'senpi-task',
    'dag',
    'runs',
  );
  if (!existsSync(runDirectory)) {
    throw new TypeError(`native DAG run ${runId} must exist.`);
  }
  requireRealDirectory(runDirectory);
  const runPath = resolve(runDirectory, `${runId}.json`);
  if (!existsSync(runPath)) {
    throw new TypeError(`native DAG run ${runId} must exist.`);
  }
  const stat = lstatSync(runPath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    realpathSync(runPath) !== runPath
  ) {
    throw new TypeError('native DAG run must be a real canonical file.');
  }
  return runPath;
};

export const canonicalNativeDagKeyPath = (
  repositoryRoot,
  keyId,
) => {
  if (
    typeof keyId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(keyId)
  ) {
    throw new TypeError('native DAG key ID must be canonical.');
  }
  const canonicalRoot = canonicalRepositoryRoot(repositoryRoot);
  const keyDirectory = resolve(
    canonicalRoot,
    '.omo',
    'senpi-task',
    'dag',
    'keys',
  );
  if (!existsSync(keyDirectory)) {
    throw new TypeError('native DAG key record must exist.');
  }
  requireRealDirectory(keyDirectory);
  const keyPath = resolve(keyDirectory, `${keyId}.json`);
  if (!existsSync(keyPath)) {
    throw new TypeError('native DAG key record must exist.');
  }
  const stat = lstatSync(keyPath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    realpathSync(keyPath) !== keyPath
  ) {
    throw new TypeError('native DAG key record must be a real canonical file.');
  }
  return keyPath;
};
