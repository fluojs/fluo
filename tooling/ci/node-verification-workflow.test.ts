import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const nodeWorkflow = readFileSync(new URL('../../.github/workflows/node-verification.yml', import.meta.url), 'utf8');

function job(source: string, id: string): string {
  const start = source.indexOf(`  ${id}:\n`);
  expect(start, `Missing job: ${id}`).toBeGreaterThanOrEqual(0);
  return source.slice(start).split(/\n(?= {2}[a-z][a-z-]*:\n)/u)[0] ?? '';
}

it('runs all supported Node targets through one sharded verification workflow', () => {
  // Given
  const nodeSupport = job(workflow, 'node-support');

  // When
  const versions = [...nodeSupport.matchAll(/^\s+- "(24\.0\.0|24\.x|26\.x)"$/gm)].map((match) => match[1]);

  // Then
  expect(versions).toEqual(['24.0.0', '24.x', '26.x']);
  expect(nodeSupport).toContain('uses: ./.github/workflows/node-verification.yml');
  expect(nodeSupport).toMatch(/node-version: \$\{\{ matrix.node-version \}\}/u);
  expect(nodeSupport).not.toContain('run: pnpm verify');
  expect(workflow).not.toMatch(/^ {2}(build-and-typecheck|lint|test):$/m);
});

it('builds the Studio dependency closure before browser verification', () => {
  // Given
  const studioBrowser = job(workflow, 'studio-browser');
  const closureBuild = 'node tooling/scripts/run-workspace-build-closure.mjs @fluojs/studio';
  const browserVerification = 'pnpm --filter @fluojs/studio test:browser';

  // When
  const commands = [...studioBrowser.matchAll(/run: (.+)/gu)].map((match) => match[1]);

  // Then
  expect(commands).toContain(closureBuild);
  expect(commands).toContain(browserVerification);
  expect(commands.indexOf(closureBuild)).toBeLessThan(commands.indexOf(browserVerification));
  expect(studioBrowser).not.toMatch(/run: pnpm --filter @fluojs\/studio(?:\.\.\.)? build/u);
});

it('keeps all four Vitest projects with complete package and tooling shards', () => {
  // Given
  const tests = job(nodeWorkflow, 'test');

  // When
  const shards = [...tests.matchAll(/project: (\w+)\n\s+shard: (\d+)\/(\d+)/gu)].map((match) => match.slice(1));
  const projects = [...tests.matchAll(/run: pnpm vitest run --project (\w+)/g)].map((match) => match[1]);

  // Then
  expect(shards).toEqual([
    ['packages', '1', '4'], ['packages', '2', '4'], ['packages', '3', '4'], ['packages', '4', '4'],
    ['tooling', '1', '2'], ['tooling', '2', '2'],
  ]);
  expect(projects.sort()).toEqual(['apps', 'examples', 'packages', 'tooling']);
  expect(tests).toMatch(/--shard=\$\{\{ matrix.shard \}\}/u);
  expect(tests).toContain("if: matrix.project == 'packages'");
  expect(tests.match(/if: matrix.lane == 'tooling-1'/g)).toHaveLength(2);
  expect(tests).toContain("if: matrix.project == 'tooling'");
  expect(tests).toMatch(/run: pnpm vitest run --project tooling --shard=\$\{\{ matrix\.shard \}\} --maxWorkers=1/u);
  expect(tests).not.toMatch(/mode|scoped|test:node-floor/u);
  expect(tests).toContain('fail-fast: false');
});

it('runs all portable adapter cases once without repeating project setup per adapter', () => {
  // Given
  const portability = job(workflow, 'official-web-runtime-adapter-portability');

  // When
  const commands = [...portability.matchAll(/run: (pnpm vitest run .+)/gu)].map((match) => match[1]);

  // Then
  expect(commands).toEqual([
    'pnpm vitest run packages/testing/src/portability/web-runtime-adapter-portability.test.ts --maxWorkers=1',
  ]);
  expect(portability).not.toContain('matrix:');
  expect(job(workflow, 'verify')).toContain('      - official-web-runtime-adapter-portability\n');
});

it('shares one cookie helper build while exercising every native runtime', () => {
  // Given
  const cookies = job(workflow, 'native-response-cookie-conformance');

  // When
  const builds = [...cookies.matchAll(/run: pnpm --filter @fluojs\/http\.\.\. build/gu)];
  const commands = [...cookies.matchAll(/run: (.+)/gu)].map((match) => match[1]);

  // Then
  expect(builds).toHaveLength(1);
  expect(cookies).not.toContain('matrix:');
  expect(cookies).not.toContain('if:');
  expect(commands).toContain('bun test tooling/native-runtime/response-cookie-conformance.test.mjs');
  expect(commands).toContain('deno test --allow-read tooling/native-runtime/response-cookie-conformance.test.mjs');
  expect(commands).toContain('node --test tooling/native-runtime/cloudflare-workers-response-cookie-conformance.test.mjs');
  expect(job(workflow, 'verify')).toContain('      - native-response-cookie-conformance\n');
});

it.each(['checks', 'test', 'starters'])('starts %s after its versioned build, without waiting for sibling checks', (id) => {
  // Given
  const consumer = job(nodeWorkflow, id);
  const build = job(nodeWorkflow, 'build');

  // When
  const dependencies = consumer.match(/needs:\n((?: {6}- [\w-]+\n)+)/u)?.[1];
  const artifactName = /name: node-build-\$\{\{ inputs.node-version \}\}-\$\{\{ github.sha \}\}/u;

  // Then
  expect(dependencies?.trim()).toBe('- build');
  expect(consumer).toMatch(/node-version: \$\{\{ inputs.node-version \}\}/u);
  expect(consumer).toContain('pnpm install --frozen-lockfile');
  expect(consumer).toMatch(artifactName);
  expect(build).toMatch(artifactName);
  expect(consumer.indexOf('run: tar -xf')).toBeLessThan(consumer.lastIndexOf('run: pnpm'));
  expect(consumer).not.toContain('continue-on-error');
});

it('preserves full typecheck, lint, one latest-24 docs run and isolated benchmark checks', () => {
  // Given
  const checks = job(nodeWorkflow, 'checks');
  const caller = job(workflow, 'node-support');

  // When
  const docsRuns = [...workflow.matchAll(/run: pnpm verify:docs/g), ...nodeWorkflow.matchAll(/run: pnpm verify:docs/g)];

  // Then
  expect(job(nodeWorkflow, 'build')).toContain('run: pnpm build');
  expect(checks).toContain('run: pnpm typecheck');
  expect(checks).toContain('run: pnpm lint');
  expect(docsRuns).toHaveLength(1);
  expect(checks).toMatch(/if: inputs.node-version == '24.x'\n\s+run: pnpm verify:docs/u);
  expect(caller).toMatch(/verify-isolated-http-benchmark:.*matrix.node-version == '24.x'.*outputs.verify_isolated_http_benchmark == 'true'/u);
  expect(checks.match(/if: inputs.verify-isolated-http-benchmark/g)).toHaveLength(2);
  expect(checks).toContain('pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile');
  expect(checks).toContain('pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace typecheck');
});

it('keeps generated browser starters and per-version shutdown evidence', () => {
  // Given
  const starters = job(nodeWorkflow, 'starters');
  const tests = job(nodeWorkflow, 'test');

  // When
  const browserInstall = starters.indexOf('playwright install --with-deps chrome');
  const sandbox = starters.indexOf('pnpm --dir packages/cli sandbox:matrix < /dev/null');

  // Then
  expect(browserInstall).toBeGreaterThan(0);
  expect(sandbox).toBeGreaterThan(browserInstall);
  expect(starters).toMatch(/FLUO_CLI_SANDBOX_ROOT:.*inputs.node-version.*github.run_id.*github.run_attempt/u);
  expect(tests).toContain("FLUO_VITEST_SHUTDOWN_DEBUG: '1'");
  expect(tests).toMatch(/name: vitest-shutdown-debug-.*inputs.node-version.*matrix.lane.*github.run_id.*github.run_attempt/u);
  expect(tests).toContain('if-no-files-found: error');
});

it('transfers generated package artifacts without losing executable modes or symbolic links', () => {
  // Given
  const directory = mkdtempSync(join(tmpdir(), 'fluo-ci-artifact-'));
  const source = join(directory, 'source');
  const restored = join(directory, 'restored');
  const archiveCommand = job(nodeWorkflow, 'build').match(/run: (tar -cf .+)/u)?.[1];
  const restoreCommand = job(nodeWorkflow, 'test').match(/run: (tar -xf .+)/u)?.[1];
  expect(archiveCommand).toBeDefined();
  expect(restoreCommand).toBeDefined();
  if (!archiveCommand || !restoreCommand) {
    throw new Error('Missing CI artifact commands');
  }

  try {
    mkdirSync(join(source, 'packages/cli/dist'), { recursive: true });
    mkdirSync(join(source, 'packages/cli/src/new'), { recursive: true });
    mkdirSync(restored);
    writeFileSync(join(source, 'packages/cli/dist/cli.mjs'), 'export const version = 1;\n');
    chmodSync(join(source, 'packages/cli/dist/cli.mjs'), 0o755);
    symlinkSync('cli.mjs', join(source, 'packages/cli/dist/entry.mjs'));
    writeFileSync(join(source, 'packages/cli/src/new/published-internal-dependencies.ts'), 'export const versions = {};\n');
    const env = { ...process.env, RUNNER_TEMP: directory };

    // When
    const archive = spawnSync('bash', ['-e', '-c', archiveCommand], { cwd: source, env, encoding: 'utf8' });
    const restore = spawnSync('bash', ['-e', '-c', restoreCommand], { cwd: restored, env, encoding: 'utf8' });

    // Then
    expect(archive.status, archive.stderr).toBe(0);
    expect(restore.status, restore.stderr).toBe(0);
    expect(readFileSync(join(restored, 'packages/cli/dist/cli.mjs'), 'utf8')).toBe('export const version = 1;\n');
    expect(lstatSync(join(restored, 'packages/cli/dist/cli.mjs')).mode & 0o777).toBe(0o755);
    expect(readlinkSync(join(restored, 'packages/cli/dist/entry.mjs'))).toBe('cli.mjs');
    expect(readFileSync(join(restored, 'packages/cli/src/new/published-internal-dependencies.ts'), 'utf8'))
      .toBe('export const versions = {};\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each(['success', 'failure', 'cancelled', 'skipped'])('handles a dependency with %s conclusion in the real aggregate gate', (result) => {
  // Given
  const verify = job(workflow, 'verify');
  const script = verify.match(/node --input-type=module <<'EOF'\n([\s\S]+?)\n {10}EOF/u)?.[1];
  expect(script).toBeDefined();
  if (!script) {
    throw new Error('Missing aggregate gate script');
  }
  const results = { 'node-support': { result }, 'deno-platform': { result: 'success' } };

  // When
  const gate = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, VERIFICATION_RESULTS: JSON.stringify(results) },
    encoding: 'utf8',
  });

  // Then
  expect(verify).toMatch(/if: \$\{\{ always\(\) && github.event_name == 'pull_request' \}\}/u);
  expect(verify).toContain('      - node-support\n');
  expect(gate.status).toBe(result === 'success' ? 0 : 1);
  if (result !== 'success') {
    expect(gate.stderr).toContain(`node-support: ${result}`);
  }
});
