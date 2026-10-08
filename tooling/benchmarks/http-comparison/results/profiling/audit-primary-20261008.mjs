import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conditionKey, validateCapture } from '../../src/profile-report.ts';
import { selectSuite } from '../../src/suites.ts';
import { TARGETS } from '../../src/targets.ts';

const root = await realpath(dirname(fileURLToPath(import.meta.url)));
const inputs = JSON.parse(await readFile(join(root, 'primary-inputs-20261008.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expected = new Set(TARGETS.flatMap((target) => selectSuite('all').flatMap((scenario) =>
  ['cpu', 'allocation', 'gc-eventloop'].map((mode) => conditionKey({
    target: target.name, platform: target.platform, scenario: scenario.name,
    mode, configuration: 'equivalent', connections: 64, repeat: 0,
  })))));
const observed = new Set();
const errors = [];
const manifests = [];
const captures = [];
const excluded = [];
const sources = new Map();
let artifactCount = 0;
let artifactBytes = 0;

for (const directory of inputs.directories) {
  const path = join(root, directory);
  const manifestBytes = await readFile(join(path, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const provenanceBytes = await readFile(join(path, 'provenance.json'));
  const provenance = JSON.parse(provenanceBytes);
  const source = provenance.benchmarkSource;
  if (sha256(provenanceBytes) !== manifest.provenanceSha256) errors.push(`${directory}:provenance-hash`);
  if (sha256(JSON.stringify(source.files)) !== source.sha256) errors.push(`${directory}:source-snapshot`);
  const inputFiles = Object.fromEntries(Object.entries(source.files).filter(([name]) =>
    name !== 'src/profile-report.ts' && name !== 'tests/profiling.test.mts'));
  const inputDigest = sha256(JSON.stringify(inputFiles));
  sources.set(source.sha256, { head: provenance.git.sha, inputDigest });
  manifests.push({ directory, sha256: sha256(manifestBytes), sourceSha256: source.sha256,
    provenanceSha256: manifest.provenanceSha256, invalidAttempts: manifest.invalidAttempts.length });

  for (const capture of manifest.captures) {
    const key = conditionKey(capture.condition);
    if (capture.status !== 'supported' && capture.status !== 'unsupported') {
      excluded.push({ directory, condition: capture.condition, status: capture.status, reason: capture.reason });
      continue;
    }
    if (!expected.has(key)) errors.push(`${directory}:unexpected-condition:${key}`);
    if (observed.has(key)) errors.push(`${directory}:duplicate-condition:${key}`);
    observed.add(key);
    const raw = new Map();
    for (const artifact of capture.artifacts) {
      const artifactPath = await realpath(join(path, artifact.path));
      const within = relative(path, artifactPath);
      if (within.startsWith('..') || within.startsWith('/')) throw new Error(`Escaped artifact: ${artifactPath}`);
      const bytes = await readFile(artifactPath);
      artifactCount++;
      artifactBytes += bytes.length;
      raw.set(artifact.path, bytes);
    }
    const failures = validateCapture(capture, raw);
    if (capture.provenanceSha256 !== manifest.provenanceSha256) failures.push('capture-provenance');
    if (failures.length) errors.push(`${directory}:${key}:${failures.join(',')}`);
    captures.push({ directory, condition: capture.condition, status: capture.status,
      reason: capture.reason, errors: failures, profilePath: capture.profilePath,
      profileSha256: capture.profilePath ? sha256(raw.get(capture.profilePath)) : null });
    raw.clear();
  }
}

for (const key of expected) if (!observed.has(key)) errors.push(`missing:${key}`);
if (new Set([...sources.values()].map((source) => source.inputDigest)).size !== 1) {
  errors.push('non-classifier-source-drift');
}
const result = {
  schemaVersion: 1, kind: 'primary-raw-artifact-audit', checkedAt: new Date().toISOString(),
  status: errors.length ? 'failed' : 'passed', issueAcceptance: 'incomplete',
  expected: expected.size, observed: observed.size, artifactCount, artifactBytes,
  supported: captures.filter((capture) => capture.status === 'supported').length,
  unsupported: captures.filter((capture) => capture.status === 'unsupported').length,
  errors, sources: Object.fromEntries(sources), manifests, captures, excluded,
  limitations: [
    'This verifies stored raw artifacts and declared capture conditions, not generator headroom or capacity.',
    'Workers Tracing.start unsupported is not proof that every GC mechanism is unsupported.',
    'Original failed manifests are immutable; only successful individual captures enter this audit.',
    'Distinct collector heads remain distinct; only classifier and its test differ in source snapshots.',
  ],
};
console.log(JSON.stringify(result));
console.log(`PRIMARY_RAW_AUDIT ${result.status} conditions=${observed.size} artifacts=${artifactCount} bytes=${artifactBytes}`);
process.exitCode = errors.length ? 1 : 0;
