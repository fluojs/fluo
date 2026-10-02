import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVerificationPlan, readVerificationManifest } from './local-verification.mjs';

const identity = {
  baseRef: 'origin/main',
  baseSha: 'b'.repeat(40),
  changedFilesDigest: 'c'.repeat(64),
  clean: true,
  diffDigest: 'd'.repeat(64),
  headSha: 'a'.repeat(40),
  mergeBase: 'e'.repeat(40),
  root: '/repo',
  treeSha: 'f'.repeat(40),
  worktreeStatusDigest: '0'.repeat(64),
};

test('the canonical PR plan covers all required groups within eighteen expanded jobs', () => {
  // Given
  const changedFiles = ['tooling/ci/verify-local.mjs'];

  // When
  const plan = buildVerificationPlan({ changedFiles, identity });

  // Then
  assert.equal(plan.version, 2);
  assert.equal(plan.profile, 'pr');
  assert.equal(plan.tasks.length + 2, 18);
  assert.deepEqual(new Set(plan.tasks.map(({ id }) => id)), new Set([
    'build', 'static',
    'packages-1', 'packages-2', 'packages-3', 'packages-4',
    'tooling-1', 'tooling-2', 'starters', 'studio',
    'compatibility-floor', 'compatibility-next', 'runtime-floor',
    'native-bun', 'native-web', 'packed',
  ]));
});

test('all companion requirements resolve to executable tasks rather than duplicate full suites', () => {
  // Given
  const changedFiles = ['packages/core/package.json', 'packages/core/src/index.mjs', 'docs/reference/node-support.md'];

  // When
  const plan = buildVerificationPlan({ changedFiles, identity });

  // Then
  const commands = plan.tasks.flatMap(({ commands }) => commands);
  assert.equal(commands.filter(({ executable, argv }) => executable === 'pnpm' && argv.join(' ') === 'test:verify').length, 0);
  for (const companion of plan.companionChecks) {
    const providers = plan.capabilityTasks[companion];
    assert.ok(providers?.length > 0, companion);
    assert.ok(providers.every((id) => plan.tasks.some((task) => task.id === id)), companion);
  }
});

test('the PR catalog executes reliability receipt regressions without adding a job', () => {
  // Given: the affected receipt consumer belongs to the existing tooling task.
  const changedFiles = ['examples/react-vite-ssr/tests/reliability-handoff.mjs'];
  // When: the canonical runner resolves its executable PR tasks.
  const plan = buildVerificationPlan({ changedFiles, identity });
  // Then: the regression is executed within the existing eighteen-job plan.
  const commands = plan.tasks.find(({ id }) => id === 'tooling-1').commands;
  assert.ok(commands.some(({ executable, argv }) => executable === 'node'
    && argv[0] === '--test' && argv.includes('examples/react-vite-ssr/tests/reliability-handoff.test.mjs')));
  assert.equal(plan.tasks.length + 2, 18);
});

test('secondary compatibility retains package tests and target-local builds without full browser checks', () => {
  // Given
  const planInput = { changedFiles: ['package.json'], identity };

  // When
  const plan = buildVerificationPlan(planInput);

  // Then
  for (const id of ['compatibility-floor', 'compatibility-next']) {
    const task = plan.tasks.find((candidate) => candidate.id === id);
    assert.ok(task, id);
    assert.ok(task.commands.some(({ argv }) => argv.join(' ') === 'install --frozen-lockfile'), id);
    assert.ok(task.commands.some(({ argv }) => argv.join(' ') === 'build'), id);
    assert.ok(task.commands.some(({ argv }) => argv.includes('--project') && argv.includes('packages')), id);
    assert.ok(task.commands.some(({ env }) => env?.FLUO_CLI_SANDBOX_PROFILE === 'smoke'), id);
  }
});

test('the extended profile restores complete secondary verification', () => {
  // Given
  const input = { changedFiles: ['package.json'], identity, profile: 'extended' };

  // When
  const plan = buildVerificationPlan(input);

  // Then
  assert.equal(plan.profile, 'extended');
  for (const id of ['compatibility-floor', 'compatibility-next']) {
    const task = plan.tasks.find((candidate) => candidate.id === id);
    assert.ok(task.commands.some(({ argv }) => argv.join(' ') === 'typecheck'), id);
    assert.ok(task.commands.some(({ argv }) => argv.join(' ') === 'lint'), id);
    assert.ok(task.commands.some(({ argv }) => argv.includes('test:verify')), id);
    assert.ok(task.commands.some(({ env }) => env?.FLUO_CLI_SANDBOX_PROFILE === 'full'), id);
  }
});

test('the runtime floor consumes a bundle without installing or compiling the workspace', () => {
  // Given
  const input = { changedFiles: ['packages/runtime/src/index.ts'], identity };

  // When
  const task = buildVerificationPlan(input).tasks.find(({ id }) => id === 'runtime-floor');

  // Then
  assert.ok(task);
  assert.equal(task.runtime, 'runtimeFloor');
  assert.ok(task.commands.every(({ executable }) => executable !== 'pnpm'));
  assert.ok(task.commands.some(({ argv }) => argv.includes('tooling/testing/node-runtime-floor.mjs')));
});

test('a missing required capability cannot create an apparently complete plan', () => {
  // Given
  const manifest = structuredClone(readVerificationManifest());
  assert.ok(Array.isArray(manifest.tasks));
  manifest.tasks = manifest.tasks.filter(({ id }) => id !== 'native-web');

  // When / Then
  assert.throws(
    () => buildVerificationPlan({ changedFiles: ['package.json'], identity, manifest }),
    /missing|capability|native-web/u,
  );
});

test('unknown verification profiles fail closed', () => {
  // Given / When / Then
  assert.throws(
    () => buildVerificationPlan({ changedFiles: ['package.json'], identity, profile: 'native-fast' }),
    /profile/u,
  );
});

test('binds embedded base arguments to the exact reviewed commit', () => {
  // Given / When
  const plan = buildVerificationPlan({ changedFiles: ['package.json'], identity });

  // Then
  const release = plan.tasks.find(({ id }) => id === 'static').commands
    .find(({ argv }) => argv.includes('tooling/release/verify-changeset-release-lane.mjs'));
  assert.ok(release.argv.includes(`--base-ref=${identity.baseSha}`));
  assert.ok(plan.tasks.every(({ commands }) => commands.every(({ argv }) => argv.every((value) => !value.includes('{baseSha}')))));
});

test('PR starters use frozen snapshots while extended checks also exercise fresh resolution', () => {
  // Given / When
  const pr = buildVerificationPlan({ changedFiles: ['package.json'], identity });
  const extended = buildVerificationPlan({ changedFiles: ['package.json'], identity, profile: 'extended' });

  // Then
  const starterCommands = (plan) => plan.tasks.flatMap(({ commands }) => commands)
    .filter(({ argv }) => argv.includes('sandbox:matrix'));
  assert.ok(starterCommands(pr).every(({ env }) => env.FLUO_CLI_SANDBOX_DEPENDENCIES === 'locked'));
  assert.equal(starterCommands(extended).filter(({ env }) => env.FLUO_CLI_SANDBOX_DEPENDENCIES === 'fresh').length, 1);
});

test('reports an inapplicable benchmark explicitly instead of claiming its capability passed', () => {
  // Given / When
  const unrelated = buildVerificationPlan({ changedFiles: ['packages/http/src/index.ts'], identity });
  const applicable = buildVerificationPlan({ changedFiles: ['tooling/benchmarks/http-comparison/run.ts'], identity });

  // Then
  assert.equal(unrelated.capabilityTasks['isolated-benchmark'], undefined);
  assert.equal(unrelated.notApplicableCapabilities['isolated-benchmark'], 'no isolated benchmark changes');
  assert.deepEqual(applicable.capabilityTasks['isolated-benchmark'], ['static']);
  assert.equal(applicable.notApplicableCapabilities['isolated-benchmark'], undefined);
});

test('host checkout paths and symbolic base refs do not change semantic plan identity', () => {
  // Given: The same reviewed tree can be checked out on local and CI hosts.
  const input = { changedFiles: ['tooling/ci/verify-local.mjs'], identity };
  const local = buildVerificationPlan(input);
  const remote = buildVerificationPlan({
    ...input, identity: { ...identity, root: '/home/runner/work/fluo/fluo', baseRef: identity.baseSha },
  });
  // When / Then: Physical paths differ, while all executable DAG semantics agree.
  assert.notEqual(local.identity.root, remote.identity.root);
  assert.equal(local.semanticDigest, remote.semanticDigest);
  assert.notEqual(JSON.stringify(local), JSON.stringify(remote));
});
