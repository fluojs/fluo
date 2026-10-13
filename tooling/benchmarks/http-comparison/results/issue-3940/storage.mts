import { constants } from 'node:buffer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { EvidenceJournal } from '../../src/evidence.js';
import { object, sha256 } from '../../src/profile-report.js';
import { equal, ExperimentInputFailure } from './plan.mjs';

type Shard = { readonly file: string; readonly sha256: string; readonly bytes: number };

// Complete originals are immutable; only the small index is rewritten.
export function shardedJournal(path: string, header: object, records: unknown[], field: 'records' | 'observations') {
  const directory = `${path}.shards`;
  mkdirSync(directory);
  const recordShards: Shard[] = [];
  const failureShards: Shard[] = [];
  function persist(value: unknown, kind: string, index: number): Shard {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    const file = `${kind}-${index}.json`;
    writeFileSync(join(directory, file), bytes, { flag: 'wx' });
    return { file, sha256: sha256(bytes), bytes: bytes.length };
  }
  function snapshot() {
    for (const record of records) recordShards.push(persist(record, 'record', recordShards.length));
    records.length = 0;
    while (failureShards.length < journal.failures.length) {
      failureShards.push(persist(journal.failures[failureShards.length], 'failure', failureShards.length));
    }
    const index = { recordShards, failureShards };
    return { ...header, storage: 'issue-3940-shards-v1', field, shardDirectory: basename(directory),
      ...index, indexSha256: sha256(JSON.stringify(index)) };
  }
  const journal = new EvidenceJournal(path, snapshot);
  // Keep EvidenceJournal's interruption/failure lifecycle, without its inline failure array.
  journal.flush = () => writeFileSync(path, `${JSON.stringify(snapshot(), null, 2)}\n`);
  return journal;
}

export function readEvidence(path: string): unknown {
  const input = object(JSON.parse(readFileSync(path, 'utf8')));
  if (input.storage !== 'issue-3940-shards-v1') return input;
  const { storage: _storage, field, shardDirectory, recordShards, failureShards, indexSha256, ...header } = input;
  if (field !== 'records' && field !== 'observations') throw new ExperimentInputFailure('Unknown shard record field');
  if (typeof shardDirectory !== 'string' || !/^[A-Za-z0-9_.-]+\.shards$/.test(shardDirectory)) {
    throw new ExperimentInputFailure('Unsafe shard directory');
  }
  const directory = join(dirname(path), shardDirectory);
  if (!Array.isArray(recordShards) || !Array.isArray(failureShards)) throw new ExperimentInputFailure('Missing shard index');
  equal(indexSha256, sha256(JSON.stringify({ recordShards, failureShards })), 'shard index hash');
  function originals(shards: unknown[], kind: string): unknown[] {
    return shards.map((entry: unknown, index: number) => {
      const shard = object(entry);
      equal(shard.file, `${kind}-${index}.json`, 'shard order/unique path');
      const bytes = readFileSync(join(directory, `${kind}-${index}.json`));
      equal(bytes.length, shard.bytes, 'shard byte count');
      equal(sha256(bytes), shard.sha256, 'shard original hash');
      if (bytes.length > constants.MAX_STRING_LENGTH) throw new ExperimentInputFailure('Single original exceeds Node maxStringLength');
      return JSON.parse(bytes.toString('utf8'));
    });
  }
  return { ...header, [field]: originals(recordShards, 'record'), invalidAttempts: originals(failureShards, 'failure') };
}
