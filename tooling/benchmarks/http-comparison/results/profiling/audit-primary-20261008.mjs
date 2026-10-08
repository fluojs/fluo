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
const environments = new Set();
const collectorEnvironments = new Set();
const servingRuntimes = new Map();
const installedBunVersions = new Set();
const superseded = new Map(inputs.superseded.map((item) => [`${item.directory}:${conditionKey(item.condition)}`, item]));
if (superseded.size !== inputs.superseded.length) throw new Error('Duplicate superseded selection');
const seenSuperseded = new Set();
let artifactCount = 0;
let artifactBytes = 0;
let supersededArtifactCount = 0;
let supersededArtifactBytes = 0;

for (const directory of inputs.directories) {
  const path = join(root, directory);
  const manifestBytes = await readFile(join(path, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const provenanceBytes = await readFile(join(path, 'provenance.json'));
  const provenance = JSON.parse(provenanceBytes);
  const source = provenance.benchmarkSource;
  const approvedSource = inputs.allowedCollectorSources[source.sha256];
  if (!approvedSource || Object.entries(approvedSource.files).some(([name, hash]) => source.files[name] !== hash)) {
    errors.push(`${directory}:unapproved-collector-source`);
  }
  environments.add(sha256(JSON.stringify(Object.fromEntries(Object.entries(provenance)
    .filter(([name]) => !['capturedAt', 'git', 'benchmarkSource'].includes(name))))));
  collectorEnvironments.add(sha256(JSON.stringify(Object.fromEntries(Object.entries(provenance)
    .filter(([name]) => !['capturedAt', 'git', 'benchmarkSource', 'bun', 'deno'].includes(name))))));
  installedBunVersions.add(provenance.bun);
  if (sha256(provenanceBytes) !== manifest.provenanceSha256) errors.push(`${directory}:provenance-hash`);
  if (sha256(JSON.stringify(source.files)) !== source.sha256) errors.push(`${directory}:source-snapshot`);
  const inputFiles = Object.fromEntries(Object.entries(source.files).filter(([name]) =>
    !inputs.collectorOnlyFiles.includes(name)));
  const inputDigest = sha256(JSON.stringify(inputFiles));
  sources.set(source.sha256, { head: provenance.git.sha, inputDigest });
  manifests.push({ directory, sha256: sha256(manifestBytes), sourceSha256: source.sha256,
    provenanceSha256: manifest.provenanceSha256, invalidAttempts: manifest.invalidAttempts.length });

  for (const capture of manifest.captures) {
    const key = conditionKey(capture.condition);
    const platform = capture.condition.platform;
    if (capture.status !== 'supported' && capture.status !== 'unsupported') {
      excluded.push({ directory, condition: capture.condition, status: capture.status, reason: capture.reason });
      continue;
    }
    const replacement = superseded.get(`${directory}:${key}`);
    if (!replacement) {
      if (!expected.has(key)) errors.push(`${directory}:unexpected-condition:${key}`);
      if (observed.has(key)) errors.push(`${directory}:duplicate-condition:${key}`);
      observed.add(key);
    }
    const raw = new Map();
    for (const artifact of capture.artifacts) {
      const artifactPath = await realpath(join(path, artifact.path));
      const within = relative(path, artifactPath);
      if (within.startsWith('..') || within.startsWith('/')) throw new Error(`Escaped artifact: ${artifactPath}`);
      const bytes = await readFile(artifactPath);
      if (replacement) {
        supersededArtifactCount++;
        supersededArtifactBytes += bytes.length;
      } else {
        artifactCount++;
        artifactBytes += bytes.length;
      }
      raw.set(artifact.path, bytes);
    }
    const failures = validateCapture(capture, raw);
    if (capture.provenanceSha256 !== manifest.provenanceSha256) failures.push('capture-provenance');
    const identity = JSON.parse(raw.get(capture.identityPath).toString());
    const runtime = identity.runtime;
    const versions = servingRuntimes.get(platform) ?? new Set();
    versions.add(platform === 'workers' ? runtime.version : platform === 'bun' ? runtime.bun
      : platform === 'deno' ? runtime.deno : runtime.node);
    servingRuntimes.set(platform, versions);
    if (replacement) {
      seenSuperseded.add(`${directory}:${key}`);
      if (capture.condition.mode !== 'allocation' || failures.length !== 1 || failures[0] !== 'malformed-profile-or-identity') {
        errors.push(`${directory}:unexpected-superseded-failures:${key}:${failures.join(',')}`);
      }
      excluded.push({ directory, condition: capture.condition, status: 'superseded',
        originalStatus: capture.status, errors: failures, replacementDirectory: replacement.replacementDirectory,
        profileSha256: sha256(raw.get(capture.profilePath)), reason: replacement.reason });
      raw.clear();
      continue;
    }
    if (failures.length) errors.push(`${directory}:${key}:${failures.join(',')}`);
    captures.push({ directory, condition: capture.condition, status: capture.status,
      reason: capture.reason, errors: failures, profilePath: capture.profilePath,
      profileSha256: capture.profilePath ? sha256(raw.get(capture.profilePath)) : null });
    raw.clear();
  }
}

for (const key of expected) if (!observed.has(key)) errors.push(`missing:${key}`);
for (const [key, item] of superseded) {
  if (!seenSuperseded.has(key)) errors.push(`missing-superseded:${key}`);
  if (!captures.some((capture) => capture.directory === item.replacementDirectory
    && conditionKey(capture.condition) === conditionKey(item.condition) && capture.status === 'supported' && !capture.errors.length)) {
    errors.push(`missing-valid-replacement:${key}`);
  }
}
if (new Set([...sources.values()].map((source) => source.inputDigest)).size !== 1) {
  errors.push('serving-source-drift');
}
if (collectorEnvironments.size !== 1 || [...servingRuntimes.values()].some((versions) => versions.size !== 1)) {
  errors.push('runtime-dependency-environment-drift');
}
const result = {
  schemaVersion: 1, kind: 'primary-raw-artifact-audit', checkedAt: new Date().toISOString(),
  status: errors.length ? 'failed' : 'passed', issueAcceptance: 'incomplete',
  expected: expected.size, observed: observed.size, artifactCount, artifactBytes,
  supersededArtifactCount, supersededArtifactBytes, environmentGroups: environments.size,
  collectorEnvironmentGroups: collectorEnvironments.size,
  servingRuntimes: Object.fromEntries([...servingRuntimes].map(([platform, versions]) => [platform, [...versions]])),
  installedBunVersions: [...installedBunVersions],
  supported: captures.filter((capture) => capture.status === 'supported').length,
  unsupported: captures.filter((capture) => capture.status === 'unsupported').length,
  errors, sources: Object.fromEntries(sources), manifests, captures, excluded,
  limitations: [
    'This verifies stored raw artifacts and declared capture conditions, not generator headroom or capacity.',
    'Workers Tracing.start unsupported is not proof that every GC mechanism is unsupported.',
    'Original manifests are immutable. Superseded allocation captures must still fail strict validation and have an exact valid replacement.',
    'Five exact collector snapshots are allowlisted; classifier/tests, headroom readiness, GC label and allocation snapshot priming differ. Serving inputs and runtime/dependency identity must remain identical.',
    'Installed metadata is not serving identity. Serving versions are extracted from hash-validated subject.json and checked against capture.subject.runtime; Bun is 1.4.2 and Workers is workerd 2025-06-04 in this evidence set.',
  ],
};
console.log(JSON.stringify(result));
console.log(`PRIMARY_RAW_AUDIT ${result.status} conditions=${observed.size} artifacts=${artifactCount} bytes=${artifactBytes}`);
process.exitCode = errors.length ? 1 : 0;
