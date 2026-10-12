import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { buildVerificationPlan, readVerificationManifest } from './local-verification.mjs';
import { collectIdentity } from './verify-local.mjs';

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

function catalogFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fluo-test-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  put('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
  put('apps/docs/package.json', JSON.stringify({ name: 'fixture-docs', scripts: { typecheck: 'tsc --noEmit' } }));
  put('apps/other/package.json', '{"name":"fixture-other"}');
  put('apps/docs/index.ts', 'export const value = 1;');
  const manifest = readVerificationManifest();
  put('tooling/ci/local-verification-manifest.json', JSON.stringify(manifest));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  return { root, put, commit, manifest };
}

test('catalog: absent apps suite -> explicit exclusion without losing full or docs coverage', (t) => {
  const { root, manifest } = catalogFixture(t);

  for (const options of [{}, { forceFull: true }, { profile: 'extended' }]) {
    const plan = buildVerificationPlan({ changedFiles: ['apps/docs/index.ts'], identity, root, manifest, ...options });

    assert.equal(plan.capabilityTasks.apps, undefined);
    assert.equal(plan.notApplicableCapabilities.apps, 'no-suite: apps has no matching test files in target checkout');
    assert.ok(plan.notApplicableCommands.some(({ command, reason }) => command.argv.includes('apps') && reason.startsWith('no-suite:')));
    assert.ok(plan.tasks.find(({ id }) => id === 'static').outputs.includes('docs-site'));
    assert.ok(plan.capabilityTasks.typecheck);
    if (options.forceFull || options.profile === 'extended') {
      assert.equal(plan.tasks.length, 16);
      const tooling = plan.tasks.find(({ id }) => id === 'tooling-1');
      assert.ok(tooling.commands.some(({ argv }) => argv.includes('examples')));
      assert.ok(tooling.commands.some(({ argv }) => argv.includes('--shard=1/2')));
      assert.ok(tooling.commands.some(({ argv }) => argv.includes('tooling/ci/react-product-acceptance.mjs')));
    } else {
      assert.deepEqual(plan.tasks.map(({ id }) => id), ['static']);
    }
  }
});

test('catalog: future apps test -> automatically selected from target root', (t) => {
  const { root, put, manifest } = catalogFixture(t);
  put('apps/docs/index.test.ts', 'import {test,expect} from "vitest";test("value",()=>expect(1).toBe(1));');
  put('apps/docs/.next/ignored.test.ts', 'throw Error("excluded");');

  const plan = buildVerificationPlan({ changedFiles: ['apps/docs/index.ts'], identity, root, manifest });

  assert.deepEqual(plan.capabilityTasks.apps, ['tooling-1']);
  assert.equal(plan.notApplicableCapabilities.apps, undefined);
  assert.deepEqual(plan.testCatalog.apps, ['apps/docs/index.test.ts']);
});

for (const operation of ['delete', 'owner-rename', 'pattern-rename']) {
  test(`catalog: last apps test ${operation} -> rejects coverage loss instead of no-suite`, (t) => {
    const { root, put, commit, manifest } = catalogFixture(t);
    put('apps/docs/index.test.ts', 'export const tested = true;');
    const base = commit();
    if (operation === 'delete') rmSync(join(root, 'apps/docs/index.test.ts'));
    else renameSync(join(root, 'apps/docs/index.test.ts'), join(root,
      operation === 'owner-rename' ? 'apps/other/index.test.ts' : 'apps/docs/index.ts'));
    commit();
    const actual = collectIdentity(root, base);

    assert.throws(() => buildVerificationPlan({ changedFiles: actual.changedFiles, identity: actual, root, manifest }), /coverage-loss.*apps\/docs/u);
  });
}

test('Vitest: zero-match selected command -> nonzero real process exit', () => {
  const repository = new URL('../../', import.meta.url).pathname;
  const run = (filter) => spawnSync('pnpm', ['vitest', 'run', '--project', 'tooling', filter, '--maxWorkers=1'], {
    cwd: repository, encoding: 'utf8', timeout: 120_000,
  });

  const missing = run('tooling/ci/nonexistent-3956.test.ts');

  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stdout + missing.stderr, /No test files found/u);
});

test('buildVerificationPlan: email leaf -> executes affected packages without unrelated suites', () => {
  const plan = buildVerificationPlan({ changedFiles: ['packages/email/src/index.ts'], identity });

  assert.equal(plan.mode, 'scoped');
  assert.ok(plan.tasks.length < 16);
  const packages = plan.tasks.filter(({ id }) => id.startsWith('packages-'));
  assert.equal(packages.length, 1);
  assert.ok(packages[0].commands.some(({ argv }) => argv.includes('packages/email/')));
  assert.ok(packages[0].commands.every(({ argv }) => !argv.includes('packages/core/')));
  assert.ok(plan.tasks.find(({ id }) => id === 'build').commands.some(({ argv }) =>
    argv.includes('--filter=@fluojs/email')));
});

test('buildVerificationPlan: CLI script changes -> retain the Node script regression suite', () => {
  for (const file of ['packages/cli/scripts/local-test-env.mjs', 'packages/cli/scripts/local-test-env.test.mjs']) {
    const plan = buildVerificationPlan({ changedFiles: [file], identity });

    assert.equal(plan.mode, 'scoped');
    assert.ok(plan.tasks.some(({ commands }) => commands.some(({ executable, argv }) =>
      executable === 'node' && argv.includes('--test')
      && argv.includes('packages/cli/scripts/*.test.mjs'))));
  }
});

test('buildVerificationPlan: prose docs -> no build or runtime prerequisites', () => {
  const plan = buildVerificationPlan({ changedFiles: ['docs/reference/node-support.md'], identity });

  assert.equal(plan.mode, 'docs');
  assert.deepEqual(plan.tasks.map(({ id }) => id), ['static']);
  assert.deepEqual(plan.tasks[0].dependencies, []);
  assert.deepEqual(plan.tasks[0].inputs, []);
  assert.ok(plan.tasks[0].commands.some(({ argv }) => argv.includes('verify:docs')));
});

test('buildVerificationPlan: explicit full and extended -> preserves all sixteen tasks', () => {
  for (const options of [{ forceFull: true }, { profile: 'extended' }]) {
    const plan = buildVerificationPlan({ changedFiles: ['packages/email/src/index.ts'], identity, ...options });

    assert.equal(plan.mode, 'full');
    assert.equal(plan.tasks.length, 16);
  }
});

test('buildVerificationPlan: representative affected inputs -> full coverage and explicit apps exclusion', () => {
  for (const changedFiles of [
    ['packages/email/src/index.ts'],
    ['packages/http/src/index.ts'],
    ['packages/core/package.json'],
    ['docs/reference/node-support.md'],
    ['packages/studio/src/index.ts'],
    [],
  ]) {
    const selected = buildVerificationPlan({ changedFiles, identity });
    const full = buildVerificationPlan({ changedFiles, identity, forceFull: true });
    const extended = buildVerificationPlan({ changedFiles, identity, profile: 'extended' });

    assert.equal(full.tasks.length, 16);
    assert.equal(extended.tasks.length, 16);
    assert.ok(selected.tasks.every(({ id }) => full.tasks.some((task) => task.id === id)));
    assert.deepEqual(full.notApplicableCommands.map(({ taskId }) => taskId), ['tooling-1']);
    for (const capability of ['examples', 'studio-browser', 'generated-starters', 'packed-consumers', 'runtime-floor',
      'bun-routing', 'web-portability', 'tooling-1', 'tooling-2', 'packages-1', 'packages-2', 'packages-3', 'packages-4']) {
      assert.ok(full.capabilityTasks[capability]?.length, capability);
      assert.ok(extended.capabilityTasks[capability]?.length, capability);
    }
    for (const id of ['compatibility-floor', 'compatibility-next']) {
      const task = extended.tasks.find((task) => task.id === id);
      for (const argv of ['build', 'typecheck', 'lint', 'test:verify']) {
        assert.ok(task.commands.some((command) => command.argv.join(' ') === argv));
      }
      assert.ok(task.commands.some(({ env }) => env?.FLUO_CLI_SANDBOX_PROFILE === 'full'));
    }
  }
});

test('buildVerificationPlan: leaf plus release metadata -> release check without docs-site build', () => {
  const plan = buildVerificationPlan({ changedFiles: ['packages/email/src/index.ts', '.changeset/sample.md'], identity });

  assert.equal(plan.mode, 'scoped');
  assert.ok(plan.tasks.every(({ outputs }) => !outputs.includes('docs-site')));
  assert.ok(plan.tasks.find(({ id }) => id === 'static').commands.some(({ argv }) => argv.includes('tooling/release/verify-changeset-release-lane.mjs')));
});

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

test('nonroot reliability task downloads all browsers without requesting OS installation', () => {
  // Given / When: resolve the task run under the caller's nonroot UID.
  const plan = buildVerificationPlan({ changedFiles: ['examples/react-vite-ssr/tests/long-session.spec.ts'], identity });
  const install = plan.tasks.find(({ id }) => id === 'tooling-1').commands
    .find(({ argv }) => argv.includes('playwright') && argv.includes('install'));
  // Then: OS dependencies belong to the locked image, not a task-side su prompt.
  assert.ok(install);
  assert.deepEqual(install.argv.slice(install.argv.indexOf('install') + 1), ['chromium', 'firefox', 'webkit']);
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
  // Then: the regression is executed in the selected tooling task.
  const commands = plan.tasks.find(({ id }) => id === 'tooling-1').commands;
  assert.ok(commands.some(({ executable, argv }) => executable === 'node'
    && argv[0] === '--test' && argv.includes('examples/react-vite-ssr/tests/reliability-handoff.test.mjs')));
  const packedRunner = commands.find(({ executable, argv }) => executable === 'node'
    && argv.length === 2 && argv[0] === '--test'
    && argv[1] === 'examples/react-vite-ssr/tests/verify-background-starter.test.mjs');
  assert.ok(packedRunner);
  assert.equal(packedRunner.cwd, '.');
  assert.equal(packedRunner.env.FLUO_BACKGROUND_EVIDENCE, '/evidence/react-product/runner-regressions');
  assert.equal(plan.mode, 'scoped');
  assert.ok(plan.tasks.length <= 16);
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
