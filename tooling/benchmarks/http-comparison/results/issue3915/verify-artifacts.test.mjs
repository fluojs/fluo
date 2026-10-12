import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { loadArtifacts, verifyArtifacts } from './verify-artifacts.mjs';

const fixture = loadArtifacts();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function mutateJson(artifacts, path, mutate) {
  const value = JSON.parse(artifacts.contents[path]);
  mutate(value);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  artifacts.contents[path] = text;
  for (const entry of [artifacts.manifest.policy, artifacts.manifest.dispositions]) {
    if (entry.path === path) {
      entry.sha256 = hash(text);
    }
  }
  for (const entry of artifacts.manifest.evidence) {
    if (entry.summary === path) {
      entry.sha256 = hash(text);
    }
  }
}

test('verifyArtifacts: engineering completion promoted to performance -> rejects', () => {
  const artifacts = structuredClone(fixture);
  mutateJson(artifacts, 'dispositions.json', (value) => {
    value.performanceVerdict = 'PASS';
  });

  const action = () => verifyArtifacts(artifacts);

  assert.throws(action, /performance/u);
});

test('verifyArtifacts: committed artifact set -> consistency only', () => {
  const artifacts = structuredClone(fixture);

  const result = verifyArtifacts(artifacts);

  assert.deepEqual(result, { status: 'ARTIFACT_CONSISTENCY_ONLY', performanceVerdict: 'NOT_ESTABLISHED' });
});

test('standalone CLI: committed artifacts without external evidence access -> exits successfully', () => {
  const executable = new URL('./verify-artifacts.mjs', import.meta.url);

  const result = spawnSync(process.execPath, [executable.pathname], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'ARTIFACT_CONSISTENCY_ONLY', performanceVerdict: 'NOT_ESTABLISHED' });
});

const cases = [
  ['malformed metric', (a) => mutateJson(a, 'summaries/bun-candidate.json',
    (s) => { s.data.observations[0].medianRatio = '1'; }), /malformed metric/u],
  ['non-finite metric', (a) => {
    const path = 'summaries/bun-candidate.json';
    a.contents[path] = a.contents[path].replace('"medianRatio": 1.0098683940797837', '"medianRatio": 1e999');
    a.manifest.evidence.find((e) => e.id === 'bun-candidate').sha256 = hash(a.contents[path]);
  }, /non-finite metric/u],
  ['negative metric', (a) => mutateJson(a, 'summaries/bun-candidate.json',
    (s) => { s.data.observations[0].ratios[0] = -1; }), /malformed metric/u],
  ['missing evidence identity', (a) => {
    a.manifest.evidence = a.manifest.evidence.filter((e) => e.id !== 'node-offline');
  }, /missing evidence identity/u],
  ['duplicate evidence identity', (a) => { a.manifest.evidence.push(a.manifest.evidence[0]); },
    /duplicate evidence identity/u],
  ['missing serving identity', (a) => mutateJson(a, 'summaries/bun-candidate.json',
    (s) => { delete s.identity.runtime; }), /missing evidence identity/u],
  ['unknown identity without reason', (a) => mutateJson(a, 'summaries/bun-candidate.json',
    (s) => { s.identity.build.reason = ''; }), /unknown identity reason/u],
  ['invalid SHA256', (a) => { a.manifest.evidence[0].sha256 = 'bad'; }, /SHA256 format/u],
  ['well-formed but wrong summary hash', (a) => { a.manifest.evidence[0].sha256 = '0'.repeat(64); },
    /compact summary hash mismatch/u],
  ['unsupported metric replaced by zero', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.platforms[5].unsupportedMetrics[0].value = 0; }), /unsupported metric/u],
  ['unsupported metric silently supported', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.platforms[5].unsupportedMetrics[0] = { metric: 'exclusiveCpu', status: 'SUPPORTED', value: 0 }; }),
  /unsupported metrics/u],
  ['missing platform', (a) => mutateJson(a, 'dispositions.json', (d) => { d.platforms.pop(); }),
    /platform\/environment/u],
  ['missing Next Pages environment', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.platforms.splice(7, 1); }), /platform\/environment/u],
  ['duplicate platform environment', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.platforms.push(d.platforms[0]); }), /platform\/environment/u],
  ['incomplete acceptance promotion', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.platforms[4].accepted = true; }), /acceptance promotion/u],
  ['inconclusive disposition promoted', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.platforms[0].disposition = 'PASS'; }), /platform\/environment/u],
  ['candidate verdict promoted', (a) => mutateJson(a, 'summaries/bun-candidate.json',
    (s) => { s.data.verdict = 'PASS'; }), /candidate verdict promotion/u],
  ['offline equality promoted to performance', (a) => mutateJson(a, 'summaries/node-offline.json',
    (s) => { s.data.performanceVerdict = 'PASS'; }), /offline performance/u],
  ['local archive advertised remotely', (a) => { a.manifest.archives[0].remoteAvailable = true; },
    /remote availability/u],
  ['local source advertised remotely', (a) => { a.manifest.evidence[0].source.access = 'public-download'; },
    /source availability/u],
  ['engineering lane prematurely complete', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.engineeringWorkflow.allLaneComplete = true; }), /engineering lane/u],
  ['missing dependency', (a) => mutateJson(a, 'dispositions.json', (d) => { d.depends_on.pop(); }),
    /dependency graph/u],
  ['candidate exclusion binding changed', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.candidateExclusions[0].candidateSource = '0'.repeat(40); }), /candidate exclusion source/u],
  ['policy limit relaxed', (a) => mutateJson(a, 'policy.json',
    (p) => { p.original.policy.stability.maxCv.rssBytes = 0.1; }), /policy source values/u],
  ['protocols conflated', (a) => mutateJson(a, 'policy.json',
    (p) => { p.protocols[1].measureSeconds = 15; }), /separate protocols/u],
  ['reference escapes subtree', (a) => { a.manifest.evidence[0].summary = '../other.json'; },
    /containment/u],
  ['absolute reference', (a) => { a.manifest.evidence[0].summary = '/tmp/other.json'; }, /containment/u],
  ['missing compact summary', (a) => { delete a.contents[a.manifest.evidence[0].summary]; },
    /missing artifact/u],
  ['evidence role misclassified', (a) => { a.manifest.evidence[0].roles = ['correctness']; },
    /evidence role/u],
  ['original timeout erased', (a) => mutateJson(a, 'summaries/host-failure.json',
    (s) => { s.data.failure.timeouts = 0; }), /original timeouts/u],
  ['original traffic errors erased', (a) => mutateJson(a, 'summaries/host-failure.json',
    (s) => { s.data.failure.errors = 0; }), /original errors/u],
  ['calibration promoted to PASS', (a) => mutateJson(a, 'summaries/node-calibration.json',
    (s) => { s.data.conditions[1].verdict = 'PASS'; }), /calibration verdicts/u],
  ['historical production failure erased', (a) => mutateJson(a, 'summaries/deployed-correctness.json',
    (s) => { s.data.historicalProductionCheck.failedRequests = 0; }), /production failure/u],
  ['historical rejected candidate promoted', (a) => mutateJson(a, 'dispositions.json',
    (d) => { d.historicalResults.expressStreamOnly = 'PASS'; }), /historical dispositions/u],
  ['undersampled results hidden', (a) => mutateJson(a, 'summaries/host-before.json',
    (s) => { s.data.belowAcceptanceMinimumRequests = 0; }), /undersampled/u],
  ['failed condition accepted', (a) => mutateJson(a, 'summaries/host-failure.json',
    (s) => { s.data.performanceAcceptance = true; }), /failed calibration/u],
  ['locale machine data diverges', (a) => {
    a.contents['REPORT.ko.md'] = a.contents['REPORT.ko.md'].replace('"issue": 3915', '"issue": 3914');
  }, /report machine values/u],
];

for (const [scenario, mutate, reason] of cases) {
  test(`verifyArtifacts: ${scenario} -> rejects`, () => {
    const artifacts = structuredClone(fixture);
    mutate(artifacts);

    const action = () => verifyArtifacts(artifacts);

    assert.throws(action, reason);
  });
}

test('verifyArtifacts: rewritten EN/KO prose with identical machine data -> accepts', () => {
  const artifacts = structuredClone(fixture);
  for (const path of ['REPORT.md', 'REPORT.ko.md']) {
    artifacts.contents[path] = artifacts.contents[path].slice(artifacts.contents[path].indexOf('```json artifact-data'));
  }

  const result = verifyArtifacts(artifacts);

  assert.equal(result.status, 'ARTIFACT_CONSISTENCY_ONLY');
});
