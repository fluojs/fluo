import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectProfileTargets } from '../src/profile';
import { selectSuite } from '../src/suites';
import { hostBoundaries, nextBuildEntry, nextFixtureDirectory, TARGETS, targetLaunch, targetRequests } from '../src/targets';

test('Pages selection: explicit targets -> native and Fluo production hosts without changing defaults', () => {
  // Given
  const defaults = selectProfileTargets();

  // When
  const pages = selectProfileTargets(['native-nextjs-pages', 'fluo-nextjs-pages']);

  // Then
  assert.deepEqual(defaults, TARGETS);
  assert.equal(defaults.length, 16);
  assert.deepEqual(pages.map((target) => target.name), ['native-nextjs-pages', 'fluo-nextjs-pages']);
  for (const target of pages) {
    const launch = targetLaunch(target, 'stage-body');
    assert.equal(launch.command, 'node');
    assert.ok(launch.args.includes(`nextjs-pages/${target.product}`));
    assert.equal(launch.env.BENCH_TARGET, target.name);
    assert.equal(launch.env.BENCH_APP_SHAPE, 'stage-body');
  }
});

test('Pages traffic: shared workload -> only host API prefix changes without mutating App requests', () => {
  // Given
  const pages = selectProfileTargets(['native-nextjs-pages', 'fluo-nextjs-pages']);
  const app = selectProfileTargets(['native-nextjs'])[0];
  const scenarios = selectSuite('all');

  // When / Then
  for (const scenario of scenarios) {
    const native = targetRequests(pages[0], scenario.requests);
    const fluo = targetRequests(pages[1], scenario.requests);
    assert.deepEqual(native, fluo);
    assert.deepEqual(native, scenario.requests.map((request) => ({ ...request, path: `/api${request.path}` })));
    assert.equal(targetRequests(app, scenario.requests), scenario.requests);
  }
});

test('Next build identity: router selection -> actual production entry and explicit cold boundaries', () => {
  // Given
  const targets = selectProfileTargets(['native-nextjs', 'fluo-nextjs', 'native-nextjs-pages', 'fluo-nextjs-pages']);

  // When / Then
  for (const target of targets) {
    const directory = `${target.nextRouter === 'pages' ? 'nextjs-pages' : 'nextjs'}/${target.product}`;
    assert.equal(nextFixtureDirectory(target), directory);
    assert.equal(nextBuildEntry(target), `${directory}/.next/server/${target.nextRouter === 'pages' ? 'pages/api/[[...path]].js' : 'app/[[...path]]/route.js'}`);
    const host = hostBoundaries(target);
    assert.equal(host.environment, `next-production-${target.nextRouter ?? 'app'}-node`);
    assert.equal(host.applicationGeneration, 'not-observed');
    assert.equal(host.deployedIsolateCold, 'not-observed; local-restart-is-not-deployed-isolate-cold');
    assert.equal(host.firstRequest, target.product === 'fluo'
      ? 'first-http-request-including-lazy-backend-import-bootstrap; not-exclusive-bootstrap-time'
      : 'first-http-request-after-host-ready');
  }
});
