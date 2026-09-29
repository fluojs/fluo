import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { buildVerificationPlan } from './local-verification.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const taskWorkflow = readFileSync(new URL('../../.github/workflows/node-verification.yml', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
const extendedWorkflow = readFileSync(new URL('../../.github/workflows/extended-verification.yml', import.meta.url), 'utf8');
const identity = {
  baseRef: 'origin/main', baseSha: 'b'.repeat(40), changedFilesDigest: 'c'.repeat(64),
  clean: true, diffDigest: 'd'.repeat(64), headSha: 'a'.repeat(40), mergeBase: 'e'.repeat(40),
  root: '/repo', treeSha: 'f'.repeat(40), worktreeStatusDigest: '0'.repeat(64),
};

it('archives the immutable image only when the exact cache key is missing', () => {
  // Given: The plan job restores a content-addressed image archive.
  const planJob = job(workflow, 'plan');
  // When: Locate the executable step that creates the archive.
  const archiveStep = planJob.split('\n      - ').find((step) => step.includes("['save', '--output'"));
  // Then: A cache hit must reuse its bytes rather than serialize the image again.
  expect(archiveStep).toBeDefined();
  expect(archiveStep).toContain("if: steps.image-cache.outputs.cache-hit != 'true'");
});

function job(source: string, id: string): string {
  const start = source.indexOf(`  ${id}:\n`);
  if (start === -1) throw new Error(`Missing job: ${id}`);
  return source.slice(start).split(/\n(?= {2}[a-z][a-z-]*:\n)/u)[0] ?? '';
}

it('expands the real workflow plan into eighteen required jobs', () => {
  // Given
  const plan = buildVerificationPlan({ changedFiles: ['package.json'], identity });
  const script = job(workflow, 'plan').match(/node --input-type=module <<'EOF'\n([\s\S]+?)\n {10}EOF/u)?.[1];
  if (!script) throw new Error('Missing executable workflow matrix resolver');
  const root = mkdtempSync(join(tmpdir(), 'fluo-ci-plan-'));
  const output = join(root, 'output');
  mkdirSync(join(root, '.omo/ci-plan'), { recursive: true });
  writeFileSync(join(root, '.omo/ci-plan/plan.json'), JSON.stringify(plan));

  try {
    // When
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8',
    });

    // Then
    expect(result.status, result.stderr).toBe(0);
    const fields = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    expect(fields.source_sha).toBe(identity.headSha);
    const tasks: unknown = JSON.parse(fields.tasks ?? 'null');
    expect(tasks).toEqual(plan.tasks.map(({ id }) => id).filter((id) =>
      !['build', 'compatibility-floor', 'compatibility-next'].includes(id)));
    expect(tasks).toHaveLength(13);
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
    expect([...jobs.matchAll(/^ {2}([a-zA-Z_][\w-]*):\n/gm)].map((match) => match[1]))
      .toEqual(['plan', 'build', 'verification', 'compatibility', 'verify']);
    expect(job(workflow, 'verification')).toContain(`task: \${{ fromJSON(needs.plan.outputs.tasks) }}`);
    expect(job(workflow, 'compatibility')).toContain('task: [compatibility-floor, compatibility-next]');
    const reusableJobs = taskWorkflow.slice(taskWorkflow.indexOf('\njobs:\n'));
    expect([...reusableJobs.matchAll(/^ {2}([a-zA-Z_][\w-]*):\n/gm)].map((match) => match[1])).toEqual(['task']);
    expect(plan.tasks.length + 2).toBe(18);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('uses the same task runner and frozen plan on every remote execution', () => {
  // Given
  const task = job(taskWorkflow, 'task');

  // When / Then
  expect(task).toContain(`ref: \${{ inputs.source-sha }}`);
  expect(task).toContain('name: ci-plan');
  expect(task).toContain('node tooling/ci/verification-runner.mjs --plan .omo/ci-plan/plan.json --task "$TASK_ID"');
  expect(task).not.toContain('run: pnpm verify');
  expect(task).not.toContain('continue-on-error');
  expect(job(workflow, 'plan')).toContain('--base-ref "$BASE_SHA" --profile "$PROFILE"');
});

it('retains all primary shards and apps/examples while removing duplicate full suites', () => {
  // Given
  const plan = buildVerificationPlan({ changedFiles: ['package.json'], identity });

  // When
  const commands = plan.tasks.flatMap(({ commands }) => commands);

  // Then
  for (let shard = 1; shard <= 4; shard += 1) {
    expect(commands.some(({ argv }) => argv.includes('packages') && argv.includes(`--shard=${shard}/4`))).toBe(true);
  }
  for (let shard = 1; shard <= 2; shard += 1) {
    expect(commands.some(({ argv }) => argv.includes('tooling') && argv.includes(`--shard=${shard}/2`))).toBe(true);
  }
  for (const project of ['apps', 'examples']) {
    expect(commands.filter(({ argv }) => argv.includes('--project') && argv.includes(project))).toHaveLength(1);
  }
  expect(commands.filter(({ argv }) => argv.join(' ') === 'verify:docs')).toHaveLength(1);
  expect(workflow).not.toContain('deterministic-preflight:');
  expect(workflow).not.toContain('verify-platform-consistency-governance:');
});

it('preserves all native runtime and packed-consumer verification capabilities', () => {
  // Given
  const plan = buildVerificationPlan({ changedFiles: ['package.json'], identity });

  // When
  const commands = plan.tasks.flatMap(({ commands }) => commands);
  const args = commands.map(({ argv }) => argv.join(' '));

  // Then
  for (const path of [
    'tooling/native-runtime/platform-bun-native-conformance.test.mjs',
    'tooling/native-runtime/drizzle-bun-conformance.test.mjs',
    'tooling/native-runtime/cloudflare-workers-response-cookie-conformance.test.mjs',
    'packages/platform-deno/deno/native-adapter.test.js',
    'packages/testing/src/portability/web-runtime-adapter-portability.test.ts',
  ]) {
    expect(args.some((value) => value.includes(path)), path).toBe(true);
  }
  expect(args.filter((value) => value.includes('tooling/native-runtime/response-cookie-conformance.test.mjs'))).toHaveLength(2);
  expect(args.some((value) => value.includes('duplicate-module-safety'))).toBe(true);
  expect(args.some((value) => value.includes('@fluojs/studio') && value.includes('test:browser'))).toBe(true);
});

it('requires producer provenance before any shared build consumer runs', () => {
  // Given
  const task = job(taskWorkflow, 'task');

  // When / Then
  expect(job(workflow, 'verification')).toContain('needs: [plan, build]');
  expect(job(workflow, 'compatibility')).toContain('needs: plan');
  expect(task).toContain('node tooling/ci/acquire-build-artifact.mjs --id "$ARTIFACT_ID" --digest "$ARTIFACT_DIGEST"');
  expect(task).toContain('--sha "$SOURCE_SHA" --name "ci-build-$SOURCE_SHA" --run-id "$GITHUB_RUN_ID"');
  expect(task.indexOf('acquire-build-artifact.mjs')).toBeLessThan(task.indexOf('verification-runner.mjs'));
  expect(task).toContain('include-hidden-files: true');
  expect(task).toContain('if-no-files-found: error');
});

it('keeps documentation artifacts and failed task evidence visible', () => {
  // Given
  const task = job(taskWorkflow, 'task');

  // When / Then
  expect(task).toContain(`name: docs-site-\${{ inputs.source-sha }}`);
  expect(task).toContain('path: .omo/ci/artifacts/docs-site');
  expect(task).toMatch(/name: Upload task evidence including failures\n\s+if: \$\{\{ always\(\) && steps\.task-history\.outcome == 'success' \}\}/u);
  expect(task).toContain(`name: ci-result-\${{ inputs.task-id }}`);
  expect(job(workflow, 'verify')).toContain('needs: [plan, build, verification, compatibility]');
  expect(job(workflow, 'verify')).toContain(`VERIFICATION_RESULTS: \${{ toJSON(needs) }}`);
  expect(job(workflow, 'verify')).toContain('--aggregate');
});

it('keeps retry-safe canonical artifacts without discarding historical task evidence', () => {
  // Given
  const taskSteps = job(taskWorkflow, 'task').split(/\n {6}- /u);
  const planSteps = job(workflow, 'plan').split(/\n {6}- /u);

  // When / Then
  for (const [steps, name] of [
    [taskSteps, 'ci-build-'], [taskSteps, 'docs-site-'], [taskSteps, 'ci-result-'],
    [planSteps, 'ci-plan'], [planSteps, 'ci-result-host-checks'],
  ] as const) {
    const uploads = steps.filter((step) => step.includes('uses: actions/upload-artifact@v6')
      && step.includes(`name: ${name}`));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain('overwrite: true');
  }
  expect(taskWorkflow).toContain('name: ci-history-');
  expect(taskWorkflow).toContain('github.run_attempt');
  expect(job(workflow, 'verify')).toContain('pattern: ci-result-*');
});

it('gates publishing on the extended profile of the exact release source', () => {
  // Given
  const release = job(releaseWorkflow, 'release');
  const extended = job(releaseWorkflow, 'extended-verification');

  // When / Then
  expect(release).toContain('needs: extended-verification');
  expect(extended).toContain('uses: ./.github/workflows/ci.yml');
  expect(extended).toContain('profile: extended');
  expect(extended).toContain(`source-sha: \${{ github.sha }}`);
  expect(extendedWorkflow).toContain('profile: extended');
  expect(extendedWorkflow).not.toContain('pull_request:');
});

it('registers the new Node regression suites without recursively executing them from tooling tests', () => {
  // Given
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  // When / Then
  expect(packageJson.scripts['test:node']).toContain('tooling/ci/*.test.mjs');
  expect(packageJson.scripts['test:node']).toContain('tooling/testing/redis-native-fixture.test.mjs');
  expect(packageJson.scripts['test:node']).toContain('.agents/skills/execute-lane/scripts/*.test.mjs');
  expect(packageJson.scripts['test:verify']).toContain('pnpm test:node');
});
