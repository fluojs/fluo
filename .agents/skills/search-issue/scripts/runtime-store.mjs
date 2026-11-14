import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { assertLedger } from './ledger-contract.mjs';
import { publishSearchArtifact } from './publish-search-artifact.mjs';
import { searchArtifact } from './publication.mjs';

export const runStore = (root, out) => {
  const repositoryRoot = realpathSync(root);
  const local = relative(resolve(root), resolve(out));
  if (!local || local.startsWith('..') || isAbsolute(local)) throw new TypeError('Run directory escapes root.');
  const directory = resolve(repositoryRoot, local);
  let path = repositoryRoot;
  for (const part of local.split(sep)) {
    path = resolve(path, part);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new TypeError('Symlink run directory.');
  }
  mkdirSync(directory, { recursive: true });
  const ledgerPath = resolve(directory, 'ledger.json');
  if (existsSync(ledgerPath) && lstatSync(ledgerPath).isSymbolicLink()) throw new TypeError('Symlink ledger.');
  const lock = `${directory}.lock`;
  if (existsSync(lock) && lstatSync(lock).isSymbolicLink()) throw new TypeError('Symlink run lock.');
  mkdirSync(lock, { recursive: true });
  const claim = resolve(lock, `${process.pid}-${randomUUID()}`);
  writeFileSync(claim, '', { flag: 'wx' });
  try {
    // Publish our claim before observing other writers. Racing contenders may
    // both fail, but cannot both enter. Dead process claims are inert on resume.
    for (const name of readdirSync(lock)) {
      if (resolve(lock, name) === claim) continue;
      if (!/^[1-9]\d*-[a-f0-9-]+$/u.test(name)) throw new TypeError('Malformed run lock claim.');
      try {
        process.kill(Number(name.split('-')[0]), 0);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') continue;
        throw error;
      }
      throw new TypeError('Run already has a live writer.');
    }
  } catch (error) {
    unlinkSync(claim);
    throw error;
  }
  return {
    root: repositoryRoot,
    read: () => assertLedger(JSON.parse(readFileSync(ledgerPath, 'utf8'))),
    init: (ledger) => {
      assertLedger(ledger);
      writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, { flag: 'wx' });
    },
    save: (ledger) => {
      assertLedger(ledger);
      const temporary = `${ledgerPath}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { flag: 'wx' });
      try { renameSync(temporary, ledgerPath); }
      finally { if (existsSync(temporary)) unlinkSync(temporary); }
    },
    close: () => unlinkSync(claim),
  };
};

export const publishLedger = (ledger, store) => {
  assertLedger(ledger);
  if (ledger.status !== 'registering' && ledger.status !== 'completed') {
    throw new TypeError('Publication requires completed registration.');
  }
  const selected = ledger.registration_results.map((receipt) => receipt.issue_number).filter((n) => n !== null);
  // Validate the completed state before creating any artifact.
  const artifactPath = `.omo/search-issue/artifacts/${ledger.run_id}.json`;
  const completed = assertLedger({
    ...ledger, status: 'completed',
    handoff: selected.length ? { artifact_path: artifactPath, command: `$create-lane ${artifactPath}` } : null,
  });
  if (selected.length) {
    try {
      publishSearchArtifact({ repositoryRoot: store.root, runId: ledger.run_id, issueNumbers: selected });
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const target = resolve(store.root, artifactPath);
      if (lstatSync(target).isSymbolicLink() ||
          JSON.stringify(JSON.parse(readFileSync(target, 'utf8'))) !==
            JSON.stringify(searchArtifact(ledger.run_id, selected))) {
        throw new TypeError('Existing artifact differs from confirmed receipts.');
      }
    }
  }
  store.save(completed);
  return completed;
};
