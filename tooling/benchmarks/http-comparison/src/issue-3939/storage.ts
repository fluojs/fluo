import { writeFileSync } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { array, object, sha256 } from '../profile-report';
import { WDIR } from '../targets';
import { evaluateAA, evaluateAAIncrementally } from './analysis';
import { DESIGN_SHA256, ExperimentInputFailure } from './plan';

const ROOT = join(WDIR, 'results/issue-3939');

async function originalPath(path: string) {
  const stat = await lstat(path);
  const original = await realpath(path);
  const inside = relative(await realpath(ROOT), original);
  if (stat.isSymbolicLink() || !stat.isFile() || !inside || isAbsolute(inside) || inside.startsWith('..')) {
    throw new ExperimentInputFailure('Shard original is outside-root or not a regular file');
  }
  return { stat, original };
}

export interface ShardReference {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export function writeRawShard(directory: string, name: string, raw: unknown): ShardReference {
  if (!/^(record|failure)-\d+\.json$/.test(name)) throw new ExperimentInputFailure('Invalid raw shard name');
  const bytes = Buffer.from(JSON.stringify(raw));
  writeFileSync(join(directory, name), bytes, { flag: 'wx', mode: 0o444 });
  return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
}

export async function readRawShard(directory: string, value: unknown): Promise<Record<string, unknown>> {
  const reference = object(value);
  if (typeof reference.path !== 'string' || !/^(record|failure)-\d+\.json$/.test(reference.path)
    || typeof reference.bytes !== 'number' || !Number.isSafeInteger(reference.bytes) || reference.bytes <= 0
    || typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256)) {
    throw new ExperimentInputFailure('Malformed or outside-root shard reference');
  }
  const path = join(directory, reference.path);
  const { stat, original } = await originalPath(path);
  const root = await realpath(directory);
  const inside = relative(root, original);
  if (isAbsolute(inside) || inside.startsWith('..')) {
    throw new ExperimentInputFailure('Shard original is outside-root or not a regular file');
  }
  if (stat.size !== reference.bytes) throw new ExperimentInputFailure('Tampered raw shard byte length');
  const bytes = await readFile(path);
  if (bytes.length !== reference.bytes || sha256(bytes) !== reference.sha256) {
    throw new ExperimentInputFailure('Tampered raw shard bytes or hash');
  }
  return object(JSON.parse(bytes.toString('utf8')));
}

export async function* readRawRecords(indexPath: string, index: Record<string, unknown>) {
  const records = array(index.records);
  for (let ordinal = 0; ordinal < records.length; ordinal += 1) {
    const reference = object(records[ordinal]);
    if (reference.path !== `record-${ordinal}.json`) throw new ExperimentInputFailure('Missing, reordered or duplicated raw shard');
    yield await readRawShard(dirname(indexPath), reference);
  }
}

export async function evaluateRawIndex(indexPath: string, manifestSha256: string, artifactsSha256: string) {
  await originalPath(indexPath);
  const indexBytes = await readFile(indexPath);
  const index = object(JSON.parse(indexBytes.toString('utf8')));
  if (index.kind !== 'issue-3939-raw-shards-v1') {
    // Historical monolithic originals remain readable, never relabeled as a
    // successful calibration after collector/source changes.
    const historical = evaluateAA(index, manifestSha256, artifactsSha256);
    return { ...historical, aa: 'HISTORICAL_NOT_ESTABLISHED', rawIndexSha256: sha256(indexBytes) };
  }
  if (index.issue !== 3939 || index.phase !== 'aa' || index.manifestSha256 !== manifestSha256
    || index.designSha256 !== DESIGN_SHA256) throw new ExperimentInputFailure('Different raw manifest, design or phase');
  const referenced = new Set(array(index.records).map((value) => object(value).path));
  for (const failure of array(index.invalidAttempts)) {
    const entry = object(failure);
    const error = entry.error === undefined ? entry : object(entry.error);
    if (error.code !== undefined) referenced.add(object(error.code).path);
  }
  if ((await readdir(dirname(indexPath))).some((name) => /^(record|failure)-\d+\.json$/.test(name) && !referenced.has(name))) {
    throw new ExperimentInputFailure('Unindexed original raw shard');
  }
  for (const failure of array(index.invalidAttempts)) {
    const entry = object(failure);
    const error = entry.error === undefined ? entry : object(entry.error);
    if (error.code !== undefined) await readRawShard(dirname(indexPath), error.code);
  }
  if (array(index.invalidAttempts).length > 0) throw new ExperimentInputFailure('Invalid attempts: calibration not established');
  return { ...await evaluateAAIncrementally(readRawRecords(indexPath, index), manifestSha256, artifactsSha256),
    rawIndexSha256: sha256(indexBytes) };
}
