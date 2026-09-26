import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  commandRecord,
  coverageManifestPath,
  loadCoverageManifest,
  publicPackageNames,
  runDuplicateModuleSafety,
  validateCoverageManifest,
  workspaceDependencyClosure,
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

  const missing = structuredClone(coverage);
  missing.packages.pop();
  assert.ok(validateCoverageManifest(missing, { root }).some((failure) => failure.includes('derived public package inventory')));

  const overClaim = structuredClone(coverage);
  overClaim.packages.find((entry) => entry.package === '@fluojs/di').topologies.push('incompatible-major-strict-peer');
  assert.ok(validateCoverageManifest(overClaim, { root }).some((failure) => failure.includes('only demonstrated for @fluojs/core')));
});

test('packed closure includes every internal dependency of applied packages', () => {
  const closure = workspaceDependencyClosure(root);

  for (const packageName of ['@fluojs/core', '@fluojs/di', '@fluojs/http', '@fluojs/runtime', '@fluojs/react',
    '@fluojs/platform-nodejs', '@fluojs/platform-fastify', '@fluojs/platform-express']) {
    assert.ok(closure.includes(packageName));
  }
  assert.ok(closure.indexOf('@fluojs/core') < closure.indexOf('@fluojs/di'));
  assert.ok(closure.indexOf('@fluojs/http') < closure.indexOf('@fluojs/platform-fastify'));
});

test('coverage file remains checked JSON rather than generated runtime state', () => {
  const source = readFileSync(coverageManifestPath(root), 'utf8');
  assert.equal(JSON.parse(source).packages.length, 43);
  assert.deepEqual(loadCoverageManifest(root).packages.map((entry) => entry.package), publicPackageNames(root));
});

test('command records preserve bounded timeout process output and signal evidence', async () => {
  await assert.rejects(
    commandRecord(
      [process.execPath, '--input-type=module', '--eval', "console.log('started'); console.error('diagnostic'); setInterval(() => {}, 1_000);"],
      root,
      100,
      {},
      { stdout: 'started', stderr: 'diagnostic' },
    ),
    (error) => {
      assert.match(error.message, /timed out/u);
      assert.equal(error.record.exitCode, null);
      assert.ok(error.record.signal);
      assert.match(error.record.stdout, /started/u);
      assert.match(error.record.stderr, /diagnostic/u);
      return true;
    },
  );
});

test('command records retain nonzero exit, signal, stdout, and stderr evidence', async () => {
  await assert.rejects(
    commandRecord(
      [process.execPath, '--input-type=module', '--eval', "console.log('stdout evidence'); console.error('stderr evidence'); process.exit(7);"],
      root,
      1_000,
    ),
    (error) => {
      assert.equal(error.record.exitCode, 7);
      assert.equal(error.record.signal, null);
      assert.match(error.record.stdout, /stdout evidence/u);
      assert.match(error.record.stderr, /stderr evidence/u);
      return true;
    },
  );
});

test('packed runner records distinct artifact paths, topology evidence, and teardown', { skip: !process.env.FLUO_RUN_PACKED_DUPLICATE_MODULE_SAFETY }, async () => {
  const result = await runDuplicateModuleSafety({
    root,
    timeoutMs: 120_000,
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.network, 'disabled');
  assert.equal(result.runs.length, 2);
  for (const run of result.runs) {
    assert.notEqual(run.consumers.a.realPath, run.consumers.b.realPath);
    assert.equal(run.consumers.a.artifact, 'A');
    assert.equal(run.consumers.b.artifact, 'B');
    assert.equal(run.consumers.a.integrity, run.consumers.b.integrity);
    assert.notEqual(run.consumers.a.marker, run.consumers.b.marker);
    assert.notEqual(run.rootConsumer.a.realPath, run.rootConsumer.b.realPath);
    for (const packageName of run.closure) {
      const first = run.consumers.a.packages[packageName];
      const second = run.consumers.b.packages[packageName];
      assert.notEqual(first.realPath, second.realPath);
      assert.notEqual(first.marker, second.marker);
      for (const [consumer, side] of [[run.consumers.a, 'A'], [run.consumers.b, 'B'],
        [run.rootConsumer.a, 'A'], [run.rootConsumer.b, 'B']]) {
        const installed = consumer.packages[packageName];
        assert.equal(installed.package, packageName);
        assert.equal(installed.artifact, side);
        assert.equal(installed.installedSha256, installed.entrySha256);
      }
    }
    assert.notEqual(run.rootConsumer.a.realPath, run.rootConsumer.c.realPath);
    assert.notEqual(run.rootConsumer.a.version, run.rootConsumer.c.version);
    for (const [cross, side] of [
      [run.rootConsumer.cross.aToB, 'A'],
      [run.rootConsumer.cross.bToA, 'B'],
      [run.rootConsumer.cross.aToC, 'A'],
      [run.rootConsumer.cross.cToA, 'B'],
    ]) {
      assert.equal(cross.error, true);
      assert.equal(cross.singleton, 'singleton');
      assert.equal(cross.request, 'request');
      assert.deepEqual(cross.context, { requestId: `fixture-${side}`, principal: `fixture-${side}` });
      assert.equal(cross.metadata, true);
      assert.equal(cross.sse.compatible, true);
      assert.equal(cross.sse.accepted, true);
      assert.match(cross.sse.frame, new RegExp(`event: fixture\\nid: 1\\ndata: \\{"artifact":"${side}"\\}`, 'u'));
      assert.deepEqual(cross.jwt, { status: 200, subject: `fixture-${side}` });
      assert.deepEqual(cross.rollback, {
        cleanupPreserved: true,
        events: ['start', 'abort', 'end'],
        originalPreserved: true,
      });
      assert.equal(cross.react.status, 200);
      assert.match(cross.react.body, new RegExp(`data-artifact="${side}"`, 'u'));
    }
    for (const packageName of ['@fluojs/core', '@fluojs/di', '@fluojs/http', '@fluojs/jwt', '@fluojs/passport',
      '@fluojs/mongoose', '@fluojs/react', '@fluojs/runtime', '@fluojs/platform-nodejs', '@fluojs/platform-fastify', '@fluojs/platform-express']) {
      assert.ok(run.closure.includes(packageName));
    }
    for (const consumer of [run.rootConsumer.a, run.rootConsumer.b]) {
      assert.deepEqual(consumer.surfaces.error, {
        code: 'DUPLICATE_MODULE_SAFETY',
        meta: { artifact: consumer.artifact },
        recognized: true,
      });
      assert.equal(consumer.surfaces.metadata, true);
      assert.equal(consumer.surfaces.requestContext.current, `fixture-${consumer.artifact}`);
      assert.equal(consumer.surfaces.requestContext.principal, `fixture-${consumer.artifact}`);
      assert.equal(consumer.surfaces.sse.accepted, true);
      assert.equal(consumer.surfaces.sse.compatible, true);
      assert.equal(consumer.surfaces.sse.closed, true);
      assert.match(consumer.surfaces.sse.frame, /event: fixture/u);
      assert.equal(consumer.surfaces.sse.status, 200);
      assert.ok(consumer.surfaces.jwtPassport.port > 0);
      assert.deepEqual(consumer.surfaces.jwtPassport.missing, { status: 401, wwwAuthenticate: 'Bearer' });
      assert.deepEqual(consumer.surfaces.jwtPassport.invalid, { status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' });
      assert.deepEqual(consumer.surfaces.jwtPassport.valid, {
        body: {
          artifact: consumer.artifact,
          principal: { scopes: ['fixture:read'], subject: `fixture-${consumer.artifact}` },
          protected: true,
        },
        status: 200,
      });
      assert.deepEqual(consumer.surfaces.rollback, {
        cleanupPreserved: true,
        events: ['start', 'abort', 'end'],
        originalPreserved: true,
      });
      assert.equal(consumer.surfaces.react.status, 200);
      assert.equal(consumer.surfaces.react.contentType, 'text/html; charset=utf-8');
      assert.match(consumer.surfaces.react.body, new RegExp(`data-artifact="${consumer.artifact}"`, 'u'));
      assert.deepEqual(consumer.surfaces.transports.map((transport) => transport.kind).sort(), ['express', 'fastify', 'node']);
      for (const transport of consumer.surfaces.transports) {
        assert.ok(transport.port > 0);
        assert.equal(transport.status, 200);
        assert.deepEqual(transport.body, {
          artifact: consumer.artifact,
          kind: transport.kind,
          request: 'served-by-packed-adapter',
        });
      }
    }
    assert.ok(run.commands.every((command) => command.argv.length > 0 && command.elapsedMs >= 0));
    assert.ok(run.topologies.some((topology) => topology.kind === 'same-version-different-path'));
    assert.ok(run.topologies.some((topology) => topology.kind === 'compatible-patch-skew'));
    assert.ok(run.topologies.some((topology) => topology.kind === 'incompatible-major-strict-peer'));
    assert.equal(run.sandboxRemoved, true);
  }
});
