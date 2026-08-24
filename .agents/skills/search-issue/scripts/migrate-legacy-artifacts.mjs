import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve, sep } from 'node:path';

import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { searchArtifact } from './publication.mjs';

const safeRunId = /^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9+._-]*$/u;
const args = process.argv.slice(2);

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const assertRealDirectory = (path, create = false) => {
  if (!existsSync(path) && create) {
    mkdirSync(path, { recursive: true });
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${path} must be a real directory.`);
  }
};

const assertLegacyArtifact = (value, filename) => {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['version', 'search_run_id', 'selected_issues']) ||
    value.version !== 1 ||
    typeof value.search_run_id !== 'string' ||
    !safeRunId.test(value.search_run_id) ||
    `${value.search_run_id}.json` !== filename ||
    !Array.isArray(value.selected_issues) ||
    value.selected_issues.length === 0 ||
    value.selected_issues.some(
      (issue) => !Number.isSafeInteger(issue) || issue <= 0,
    ) ||
    new Set(value.selected_issues).size !== value.selected_issues.length
  ) {
    throw new TypeError(`${filename} is not a canonical legacy artifact.`);
  }
};

const publishIdempotent = (path, value) => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== content) {
      throw new TypeError(`${basename(path)} collides with different bytes.`);
    }
    return;
  }
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
};

const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

const sourceDirectory = resolve(valueAfter('--source'));
const targetDirectory = resolve(valueAfter('--target'));
const migratedAt = valueAfter('--migrated-at');
const migratedDate = new Date(migratedAt);
if (
  Number.isNaN(migratedDate.getTime()) ||
  migratedDate.toISOString() !== migratedAt
) {
  throw new TypeError('--migrated-at must be a canonical UTC timestamp.');
}
assertRealDirectory(sourceDirectory);
assertRealDirectory(targetDirectory, true);

const filenames = readdirSync(sourceDirectory)
  .filter(
    (filename) =>
      filename.endsWith('.json') && filename !== 'migration-receipt.json',
  )
  .sort();
const artifacts = filenames.map((filename) => {
  const sourcePath = resolve(sourceDirectory, filename);
  const sourceBytes = readFileSync(sourcePath);
  const legacy = JSON.parse(sourceBytes.toString('utf8'));
  assertLegacyArtifact(legacy, filename);
  const target = searchArtifact(
    legacy.search_run_id,
    legacy.selected_issues,
  );
  assertContract('search-artifact-v2', target);
  publishIdempotent(resolve(targetDirectory, filename), target);
  return {
    filename,
    source_sha256: sha256(sourceBytes),
    target_artifact_id: target.artifact_id,
    target_sha256: target.sha256,
  };
});

const receipt = {
  version: 1,
  migrated_at: migratedAt,
  source_root: '.opencode-backup/search-issue',
  target_root: '.omo/search-issue/artifacts/legacy',
  artifacts,
};
publishIdempotent(
  resolve(targetDirectory, 'migration-receipt.json'),
  receipt,
);
const marker = `${sep}.omo${sep}`;
const markerIndex = targetDirectory.lastIndexOf(marker);
const receiptPath =
  markerIndex === -1
    ? 'migration-receipt.json'
    : `${targetDirectory.slice(markerIndex + 1).split(sep).join('/')}/migration-receipt.json`;
process.stdout.write(
  `${JSON.stringify({
    status: 'migrated',
    artifact_count: artifacts.length,
    receipt: receiptPath,
  })}\n`,
);
