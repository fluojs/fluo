import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256 = /^[a-f0-9]{64}$/u;
const gitSha = /^[a-f0-9]{40}$/u;
const requiredEvidence = {
  'bun-candidate': ['summary', 'candidate'],
  'node-candidate': ['summary', 'candidate'],
  'node-raw': ['raw'],
  'node-offline': ['offline-reevaluation'],
  'node-calibration': ['summary', 'calibration'],
  'bun-calibration': ['summary', 'calibration'],
  'host-before': ['summary', 'calibration'],
  'host-failure': ['summary', 'calibration'],
  'next-diagnostic': ['diagnostic'],
  'workers-correctness': ['correctness'],
  'next-correctness': ['correctness'],
  'deployed-correctness': ['correctness'],
  ...Object.fromEntries([3911, 3912, 3913, 3914].flatMap((issue) => [
    [`engineering-${issue}`, ['engineering']],
    [`cleanup-${issue}`, ['archive']],
    [`archive-${issue}`, ['archive']],
  ])),
  'pre-exclusion-archive': ['archive'],
  'archive-plan': ['archive'],
  'measurement-archives': ['archive'],
};
const requiredPlatforms = [
  ['fastify/node', 'INCONCLUSIVE'], ['express/node', 'INCONCLUSIVE'],
  ['nodejs/node', 'INCONCLUSIVE'], ['bun/bun', 'INCONCLUSIVE'],
  ['workers/local-workerd', 'INCOMPLETE'], ['workers/deployed-version-url', 'CORRECTNESS_ONLY'],
  ['nextjs/production-node-app', 'INCOMPLETE'], ['nextjs/production-node-pages', 'INCOMPLETE'],
  ['deno/deno', 'EXCLUDED_BY_OWNER_NOT_PASS'],
];

function reference(path, prefix = '') {
  assert.equal(typeof path, 'string', 'reference path required');
  assert.ok(path.length > 0 && !isAbsolute(path) && !path.includes('\\') &&
    !path.split('/').some((part) => part === '..' || part === '.' || part === ''),
  'reference containment');
  assert.ok(path.startsWith(prefix), 'reference namespace');
}

function machineValues(value) {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), 'non-finite metric');
  } else if (value && typeof value === 'object') {
    if (value.status === 'UNKNOWN') {
      assert.ok(typeof value.reason === 'string' && value.reason.length > 0, 'unknown identity reason');
    }
    if (value.status === 'UNSUPPORTED') {
      assert.equal(value.value, null, 'unsupported metric must be null');
    }
    for (const [key, child] of Object.entries(value)) {
      if (/sha256$/iu.test(key)) {
        assert.match(child, sha256, 'SHA256 format');
      }
      machineValues(child);
    }
  }
}

function containedPath(directory, path) {
  assert.equal(typeof path, 'string', 'reference path required');
  assert.ok(!isAbsolute(path) && !path.split(/[\\/]/u).includes('..'), 'reference containment');
  const actual = realpathSync(resolve(directory, path));
  const child = relative(realpathSync(directory), actual);
  assert.ok(child !== '' && !child.startsWith('..') && !isAbsolute(child), 'realpath containment');
  return actual;
}

export function loadArtifacts(directory = root) {
  const text = (path) => readFileSync(containedPath(directory, path), 'utf8');
  const manifest = JSON.parse(text('manifest.json'));
  const contents = {};
  for (const path of [
    manifest.policy.path, manifest.dispositions.path,
    ...manifest.evidence.map((entry) => entry.summary),
    ...manifest.reports.map((entry) => entry.path),
  ]) {
    contents[path] = text(path);
  }
  return { manifest, contents };
}

export function verifyArtifacts(artifacts) {
  const { manifest, contents } = artifacts;
  assert.equal(manifest.schemaVersion, 1, 'manifest schema');
  assert.equal(manifest.issue, 3915, 'manifest issue');
  assert.equal(manifest.preflightSha256, '2f2b8b66aaf4cb4cc57c622dc7c65eaf606177dacfd716801fb971068823a4f7', 'preflight binding');
  assert.equal(manifest.startingHead, '9a91d1347be38757ecc433fe6496ea94e2b70587', 'starting head');
  assert.equal(manifest.performanceVerdict, 'NOT_ESTABLISHED', 'manifest performance');
  assert.equal(manifest.checkerMeaning, 'ARTIFACT_CONSISTENCY_ONLY', 'checker meaning');
  machineValues(manifest);
  const json = (path) => {
    reference(path);
    assert.equal(typeof contents[path], 'string', 'missing artifact');
    return JSON.parse(contents[path]);
  };
  const bound = (entry) => {
    const value = json(entry.path);
    assert.equal(hash(contents[entry.path]), entry.sha256, 'artifact hash mismatch');
    return value;
  };
  assert.equal(manifest.policy.path, 'policy.json', 'policy path');
  assert.equal(manifest.dispositions.path, 'dispositions.json', 'dispositions path');
  const policy = bound(manifest.policy);
  const dispositions = bound(manifest.dispositions);
  machineValues(policy);
  machineValues(dispositions);
  assert.equal(policy.schemaVersion, 1, 'policy schema');
  for (const [item, field, semantic, bytes] of [
    [policy.original, 'policy', 'b012894325786ad74b286a537d6b7483c4a79accb6a6d834b9aee4e63d88fa5b', 'e411f07a12486673a9aaebea5e44aa2da9b05b050fccb9a0f7952439bbb8fbb6'],
    [policy.denoAmendment, 'amendment', '7af9f766d65b962827ae1734377d23de78d74149ea0f6fe9130866f045d90e4b', '59cbc13fe47504ec9fbd6277cb2c1b7bc3cc88e9d19e2873052a920aacf7f1b1'],
    [policy.completionAmendment, 'amendment', null, '6f922d7a54246f5b3bb47472af60dac095f97dbd0ec40d4a3c3756a55ae38e79'],
  ]) {
    reference(item.source.locator, '.omo/verification/');
    assert.equal(item.source.access, 'local-only', 'policy availability');
    assert.equal(item.source.byteSha256, bytes, 'policy byte binding');
    const contentHash = item === policy.completionAmendment
      ? 'b5ea4e61dcd44b619897ab2e46019b9c05e26c633956246d4ffa47e1a40808a8' : bytes;
    assert.equal(hash(`${JSON.stringify(item[field], null, 2)}\n`), contentHash, 'policy source values');
    if (semantic) {
      assert.equal(item.source.semanticSha256, semantic, 'policy semantic binding');
      assert.equal(item[field].sha256, semantic, 'policy original semantic identity');
    }
  }
  assert.deepEqual(policy.protocols, [
    { id: 'original', warmupSeconds: 5, measureSeconds: 15 },
    { id: 'bun-nas', warmupSeconds: 30, measureSeconds: 60 },
    { id: 'node-nas', warmupSeconds: 30, measureSeconds: 180 },
  ], 'separate protocols');
  assert.equal(policy.scheduledGatesOperational, false, 'prospective schedule');
  assert.equal(policy.numericalEngine, 'tooling/benchmarks/http-comparison/results/issue-3914/paired-aa.mts', 'numerical engine ownership');
  assert.equal(policy.numericalEngineHead, 'c169f9095a76b4b7d139427ff3cabf653413cdd0', 'numerical engine head');

  const summaries = new Map();
  const paths = new Set();
  for (const entry of manifest.evidence) {
    assert.ok(Object.hasOwn(requiredEvidence, entry.id), 'unexpected evidence identity');
    assert.ok(!summaries.has(entry.id), 'duplicate evidence identity');
    reference(entry.summary, 'summaries/');
    assert.ok(!paths.has(entry.summary), 'duplicate evidence path');
    paths.add(entry.summary);
    reference(entry.source.locator, '.omo/verification/');
    assert.equal(entry.source.access, 'local-only', 'source availability');
    const summary = json(entry.summary);
    assert.equal(hash(contents[entry.summary]), entry.sha256, 'compact summary hash mismatch');
    assert.equal(summary.schemaVersion, 1, 'summary schema');
    assert.equal(summary.id, entry.id, 'evidence identity mismatch');
    assert.deepEqual(summary.roles, requiredEvidence[entry.id], 'evidence role');
    assert.deepEqual(entry.roles, summary.roles, 'manifest evidence role');
    assert.deepEqual(summary.source, entry.source, 'source binding');
    for (const field of ['frameworkSource', 'producerHead', 'harness', 'collector', 'validator',
      'runtime', 'host', 'build', 'lockfile', 'condition', 'measurement']) {
      assert.ok(summary.identity[field], 'missing evidence identity field');
    }
    machineValues(summary);
    if (['bun-candidate', 'node-candidate', 'bun-calibration'].includes(entry.id)) {
      const metrics = ['throughputRps', 'serverCpuMicrosPerRequest', 'p95Ms', 'p99Ms', 'rssBytes'];
      assert.deepEqual(summary.data.observations.map((item) => item.metric), metrics, 'metric inventory');
      for (const item of summary.data.observations) {
        for (const field of ['nativeBlockCv', 'ratios']) {
          assert.equal(item[field].length, 3, 'metric samples');
          assert.ok(item[field].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0), 'malformed metric');
        }
        for (const field of ['globalNativeCv', 'xCv', 'yCv', 'ratioCv', 'medianRatio']) {
          assert.ok(typeof item[field] === 'number' && Number.isFinite(item[field]) && item[field] >= 0, 'malformed metric');
        }
      }
    }
    summaries.set(entry.id, summary.data);
  }
  assert.deepEqual([...summaries.keys()].sort(), Object.keys(requiredEvidence).sort(), 'missing evidence identity');
  const data = (id) => summaries.get(id);
  assert.equal(dispositions.schemaVersion, 1, 'dispositions schema');
  assert.equal(dispositions.issue, 3915, 'dispositions issue');
  assert.equal(dispositions.performanceVerdict, 'NOT_ESTABLISHED', 'performance promotion forbidden');
  assert.equal(dispositions.canonicalAcceptance, false, 'performance acceptance forbidden');
  assert.deepEqual(dispositions.depends_on, [3911, 3912, 3913, 3914], 'dependency graph');
  const engineering = dispositions.engineeringWorkflow;
  assert.equal(engineering.status, 'DEPENDENCIES_MERGED_REPORT_LOCAL_ONLY', 'engineering status');
  assert.equal(engineering.allLaneComplete, false, 'engineering lane completion forbidden');
  assert.equal(engineering.issue3915.status, 'LOCAL_ARTIFACT_IMPLEMENTATION', 'engineering issue3915 status');
  assert.equal(engineering.issue3915.remainingGates.length, 6, 'remaining engineering gates');
  assert.deepEqual(engineering.dependencies.map((dep) => dep.issue), dispositions.depends_on, 'engineering dependencies');
  for (const dep of engineering.dependencies) {
    const receipt = data(dep.mergeEvidence);
    assert.equal(dep.state, 'MERGED', 'dependency merge state');
    assert.equal(receipt.merge.state, 'MERGED', 'dependency receipt state');
    assert.equal(dep.head, receipt.merge.headRefOid, 'dependency head');
    assert.equal(dep.mergeCommit, receipt.merge.mergeCommit.oid, 'dependency merge commit');
    assert.match(dep.head, gitSha, 'dependency Git SHA');
    assert.equal(dep.pr, receipt.merge.number, 'dependency PR');
    assert.equal(dep.githubCi.head, receipt.head, 'CI head');
    assert.equal(dep.githubCi.successfulChecks, 18, 'CI check count');
    assert.equal(receipt.checks.length, 18, 'receipt CI count');
    assert.ok(receipt.checks.every((check) => check.conclusion === 'SUCCESS' && check.status === 'COMPLETED'), 'CI status');
    for (const axis of ['contract', 'code', 'verification']) {
      assert.equal(dep.review[axis], 'PASS', 'lead-reported review status');
    }
    assert.equal(dep.cleanup, 'COMPLETE', 'dependency cleanup');
    assert.ok(data(dep.cleanupEvidence).ok === true || data(dep.cleanupEvidence).status === 'COMPLETE', 'cleanup receipt');
  }
  assert.deepEqual(dispositions.platforms.map((item) => [`${item.platform}/${item.environment}`, item.disposition]).sort(),
    [...requiredPlatforms].sort(), 'platform/environment disposition');
  for (const platform of dispositions.platforms) {
    assert.equal(platform.accepted, false, 'incomplete/inconclusive acceptance promotion');
    assert.ok(platform.limitations.length > 0, 'platform limitations');
    for (const id of platform.evidence) {
      assert.ok(summaries.has(id), 'platform evidence identity');
    }
    if (platform.platform === 'deno') {
      assert.equal(platform.publicSupportRetained, true, 'Deno public support');
      assert.equal(platform.functionalRegressionRequired, true, 'Deno regression obligation');
    }
    if (platform.environment === 'deployed-version-url') {
      assert.deepEqual(platform.unsupportedMetrics, ['exclusiveCpu', 'rssBytes', 'throughputRps', 'isolateColdMs']
        .map((metric) => ({ metric, status: 'UNSUPPORTED', value: null })), 'unsupported metrics');
    }
  }
  for (const [index, id, source] of [
    [0, 'bun-candidate', '2f4dd790acac4fc5b73e04291b6a2481a5108e54'],
    [1, 'node-candidate', '99614b72c801542b220e620b91dad7a944c64c40'],
  ]) {
    const exclusion = dispositions.candidateExclusions[index];
    const dependency = engineering.dependencies[index];
    assert.equal(exclusion.issue, dependency.issue, 'candidate exclusion issue');
    assert.equal(exclusion.candidateSource, source, 'candidate exclusion source');
    assert.equal(exclusion.exclusionCommit, dependency.head, 'candidate exclusion commit');
    assert.equal(exclusion.mergeCommit, dependency.mergeCommit, 'candidate exclusion merge');
    assert.equal(exclusion.finalSourceEqualsBase, true, 'candidate runtime excluded');
    assert.equal(exclusion.changesetRemoved, true, 'candidate release excluded');
    assert.equal(data(id).verdict, 'INCONCLUSIVE', 'candidate verdict promotion');
  }
  assert.equal(dispositions.candidateExclusions.length, 2, 'candidate exclusion inventory');
  for (const [id, runs, requests] of [
    ['bun-candidate', 12, 4642263], ['node-candidate', 12, 7856265],
    ['bun-calibration', 12, 4607948], ['node-calibration', 36, 21188080],
  ]) {
    assert.equal(data(id).completedRuns, runs, 'source run count');
    assert.equal(data(id).measuredRequests, requests, 'source request count');
  }
  assert.equal(data('node-offline').performanceVerdict, 'INCONCLUSIVE', 'offline performance promotion');
  assert.equal(data('node-offline').status, 'PASS_OFFLINE_REEVALUATION_EQUALITY', 'offline evidence role');
  assert.deepEqual(data('node-offline').decision.observations, data('node-candidate').observations, 'offline equality');
  assert.equal(data('bun-calibration').verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE', 'calibration-only verdict');
  assert.deepEqual(data('node-calibration').conditions.map((item) =>
    [item.platform, item.verdict, item.completedRuns, item.measuredRequests]), [
    ['nodejs', 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE', 12, 7824418],
    ['fastify', 'INCONCLUSIVE', 12, 9199248],
    ['express', 'INCONCLUSIVE', 12, 4164414],
  ], 'calibration verdicts retained');
  for (const id of ['bun-candidate', 'node-candidate']) {
    assert.deepEqual(data(id).evidenceErrors, [], 'candidate evidence errors retained');
    assert.deepEqual(data(id).invalidAttempts, [], 'candidate invalid attempts retained');
    assert.deepEqual(data(id).budgetBreaches, [], 'candidate budget observations retained');
  }
  assert.equal(data('node-raw').matchedFiles, 64, 'raw identity count');
  assert.equal(data('node-raw').files.length, 64, 'raw file count');
  assert.equal(new Set(data('node-raw').files.map((item) => item.path)).size, 64, 'raw duplicate identity');
  assert.equal(data('host-before').expectedRuns, 264, 'expected BEFORE samples');
  assert.equal(data('host-before').completedRuns, 263, 'incomplete BEFORE samples');
  assert.equal(data('host-before').completedMeasuredRequests, 2454837, 'BEFORE request count');
  assert.equal(data('host-before').belowAcceptanceMinimumRequests, 241, 'undersampled BEFORE count');
  assert.equal(data('host-before').status, 'PARTIAL_BEFORE_CALIBRATION_ONE_FAILED_CONDITION', 'incomplete calibration status');
  assert.equal(data('host-before').failedRuns, 1, 'failed sample retained');
  assert.equal(data('host-failure').status, 'FAILED_PARTIAL_BEFORE_ONLY_CALIBRATION', 'original failure status');
  assert.equal(data('host-failure').unattemptedRuns, 169, 'continuation boundary');
  assert.equal(data('host-failure').failure.timeouts, 7, 'original timeouts retained');
  assert.equal(data('host-failure').failure.errors, 7, 'original errors retained');
  assert.deepEqual([
    data('host-failure').failure.configuration, data('host-failure').failure.target,
    data('host-failure').failure.scenario, data('host-failure').failure.connections,
  ], ['default', 'native-nextjs', 'stage-routing-params', 64], 'failed condition identity');
  assert.equal(data('host-failure').failure.completedRequests, 1666, 'original failed requests retained');
  assert.equal(data('host-failure').performanceAcceptance, false, 'failed calibration promotion');
  assert.equal(data('deployed-correctness').conditionsPassed, 44, 'deployed correctness conditions');
  assert.equal(data('deployed-correctness').remoteRequests, 180, 'deployed request boundary');
  assert.equal(data('deployed-correctness').cumulativeDirectRequests, 204, 'deployed cumulative boundary');
  assert.equal(data('deployed-correctness').cap, 250, 'deployed cap');
  assert.equal(data('deployed-correctness').performanceVerdict, 'NOT_ESTABLISHED', 'deployed performance promotion');
  assert.equal(data('deployed-correctness').historicalProductionCheck.failedRequests, 2, 'production failure retained');
  assert.equal(data('workers-correctness').status, 'PASS_FINITE_HTTP_CORRECTNESS_ONLY', 'local correctness-only verdict');
  assert.equal(data('next-correctness').status, 'PASS_FINITE_HTTP_CORRECTNESS_ONLY', 'Next correctness-only verdict');
  assert.equal(data('next-diagnostic').status, 'DIAGNOSTIC_COMPLETE_TIMEOUT_NOT_REPRODUCED', 'diagnostic role retained');
  assert.equal(dispositions.nestComparison.competitivenessVerdict, 'NOT_ESTABLISHED', 'Nest parity not established');
  assert.deepEqual(dispositions.historicalResults, {
    expressCombined: 'CANDIDATE_REJECTED', expressStreamOnly: 'REJECT_CANDIDATE',
    headerIndex: 'INCONCLUSIVE', originalNativeNext: 'FAILED_PARTIAL_BEFORE_ONLY_CALIBRATION',
    diagnostic: 'DIAGNOSTIC_COMPLETE_TIMEOUT_NOT_REPRODUCED', deployedProduction: 'FAILED_CORRECTNESS_RETAINED',
  }, 'historical dispositions retained');
  for (const archive of manifest.archives) {
    reference(archive.path, '.omo/verification/');
    assert.equal(archive.access, 'local-only', 'archive availability');
    assert.equal(archive.remoteAvailable, false, 'archive remote availability forbidden');
    assert.ok(typeof archive.scope === 'string' && archive.scope.length > 0, 'archive preservation scope');
  }
  assert.equal(manifest.archives.length, 10, 'archive inventory');
  const pre = data('pre-exclusion-archive');
  assert.equal(pre.raw.archiveMembers, 5235, 'pre-exclusion archive members');
  for (const receipt of [pre, ...[3911, 3912, 3913, 3914].map((issue) => data(`archive-${issue}`))]) {
    const artifacts = receipt.artifacts ?? [receipt.history, receipt.raw ?? receipt.rawAndReports];
    for (const artifact of artifacts) {
      assert.ok(manifest.archives.some((entry) => entry.path.endsWith(`/${artifact.path}`) &&
        entry.sha256 === artifact.sha256), 'archive receipt hash binding');
    }
    assert.equal(receipt.commandExitCode, 0, 'archive command result');
    assert.equal(receipt.gitBundleVerifyExitCode ?? receipt.history.gitBundleVerifyExitCode, 0, 'bundle verify result');
  }
  assert.equal(data('measurement-archives').access, 'local-only', 'measurement archive availability');
  assert.equal(data('measurement-archives').originalWorktreesRemoved, false, 'measurement worktrees retained');
  const binding = {
    schemaVersion: 1, issue: 3915, performanceVerdict: dispositions.performanceVerdict,
    engineeringStatus: engineering.status, allLaneComplete: false, depends_on: dispositions.depends_on,
    policySha256: manifest.policy.sha256, dispositionsSha256: manifest.dispositions.sha256,
    evidence: manifest.evidence.map(({ id, sha256: digest }) => ({ id, sha256: digest })),
  };
  assert.deepEqual(manifest.reports, [{ path: 'REPORT.md', locale: 'en' }, { path: 'REPORT.ko.md', locale: 'ko' }], 'report locales');
  for (const report of manifest.reports) {
    reference(report.path);
    const blocks = [...contents[report.path].matchAll(/```json artifact-data\n([\s\S]*?)\n```/gu)];
    assert.equal(blocks.length, 1, 'report machine binding count');
    assert.deepEqual(JSON.parse(blocks[0][1]), binding, 'report machine values');
  }
  return { status: 'ARTIFACT_CONSISTENCY_ONLY', performanceVerdict: 'NOT_ESTABLISHED' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(verifyArtifacts(loadArtifacts(process.argv[2] ?? root)))}\n`);
}
