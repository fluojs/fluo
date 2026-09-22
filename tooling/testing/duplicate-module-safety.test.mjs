import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  coverageManifestPath,
  loadCoverageManifest,
  publicPackageNames,
  runDuplicateModuleSafety,
  validateCoverageManifest,
} from './duplicate-module-safety.mjs';

const root = new URL('../..', import.meta.url);

test('coverage manifest exactly tracks the current public workspace package surface', () => {
  const coverage = loadCoverageManifest(root);
  const expected = publicPackageNames(root);

  assert.equal(expected.length, 43);
  assert.deepEqual(coverage.packages.map((entry) => entry.package), expected);
  assert.deepEqual(validateCoverageManifest(coverage, { root }), []);
});

test('coverage validation rejects stale, duplicate, unsupported, and invented evidence', () => {
  const coverage = loadCoverageManifest(root);
  const malformed = structuredClone(coverage);
  malformed.packages[0].package = malformed.packages[1].package;
  malformed.packages[1].topologies = ['unknown'];
  malformed.packages[2].evidence = ['does-not-exist.mjs'];

  const failures = validateCoverageManifest(malformed, { root });

  assert.ok(failures.some((failure) => failure.includes('duplicate')));
  assert.ok(failures.some((failure) => failure.includes('topology')));
  assert.ok(failures.some((failure) => failure.includes('evidence path')));
});

test('coverage file remains checked JSON rather than generated runtime state', () => {
  const source = readFileSync(coverageManifestPath(root), 'utf8');
  assert.doesNotMatch(source, /\b42\b/u);
  assert.deepEqual(JSON.parse(source), loadCoverageManifest(root));
});

test('packed runner records distinct artifact paths, topology evidence, and teardown', { skip: !process.env.FLUO_RUN_PACKED_DUPLICATE_MODULE_SAFETY }, async () => {
  const result = await runDuplicateModuleSafety({
    root,
    packageNames: ['@fluojs/core', '@fluojs/di'],
    timeoutMs: 120_000,
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.network, 'disabled');
  assert.equal(result.runs.length, 2);
  for (const run of result.runs) {
    assert.notEqual(run.consumers.a.realPath, run.consumers.b.realPath);
    assert.equal(run.consumers.a.artifact, 'A');
    assert.equal(run.consumers.b.artifact, 'B');
    assert.ok(run.commands.every((command) => command.argv.length > 0 && command.elapsedMs >= 0));
    assert.ok(run.topologies.some((topology) => topology.kind === 'same-version-different-path'));
    assert.ok(run.topologies.some((topology) => topology.kind === 'compatible-patch-skew'));
    assert.ok(run.topologies.some((topology) => topology.kind === 'incompatible-major-strict-peer'));
    assert.equal(run.sandboxRemoved, true);
  }
});
