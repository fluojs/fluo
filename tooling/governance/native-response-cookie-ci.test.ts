import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

import { readVerificationManifest } from '../ci/local-verification.mjs';

it('builds the portable cookie helper dependency closure in native CI', () => {
  // Given
  const { tasks } = readVerificationManifest();

  // When
  const nativeTask = tasks.find(({ capabilities }) => capabilities.includes('native-cookies'));
  const buildTask = tasks.find(({ id }) => id === 'build');

  // Then
  expect(nativeTask?.dependencies).toContain('build');
  expect(nativeTask?.inputs).toContain('build.tar');
  expect(buildTask?.outputs).toContain('build.tar');
  expect(buildTask?.commands).toContainEqual({ executable: 'pnpm', argv: ['build'], cwd: '.' });
  expect(nativeTask?.commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ executable: 'bun', argv: ['test', 'tooling/native-runtime/response-cookie-conformance.test.mjs'] }),
    expect.objectContaining({ executable: 'deno', argv: ['test', '--allow-read', 'tooling/native-runtime/response-cookie-conformance.test.mjs'] }),
    expect.objectContaining({ executable: 'node', argv: ['--test', 'tooling/native-runtime/cloudflare-workers-response-cookie-conformance.test.mjs'] }),
  ]));
});

it('runs sharded PR suites with one worker to prevent shared artifact build races', () => {
  // Given
  const { tasks } = readVerificationManifest();

  // When
  const testCommands = tasks.flatMap(({ commands }) => commands)
    .filter(({ argv }) => argv.includes('vitest') && argv.some((arg) => arg.startsWith('--shard=')));

  // Then
  expect(testCommands).toHaveLength(6);
  for (const command of testCommands) {
    expect(command.argv).toContain('--maxWorkers=1');
  }
  expect(testCommands.flatMap(({ argv }) => argv.filter((arg) => arg.startsWith('--shard='))).sort())
    .toEqual(['--shard=1/2', '--shard=1/4', '--shard=2/2', '--shard=2/4', '--shard=3/4', '--shard=4/4']);
});

it('requires the Deno platform job before the Verify aggregate can pass', () => {
  // Given
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8');
  const { tasks } = readVerificationManifest();

  // When
  const verifyJob = workflow.slice(workflow.indexOf('  verify:\n'));
  const denoTask = tasks.find(({ capabilities }) => capabilities.includes('deno-native'));

  // Then
  expect(denoTask?.commands).toEqual(expect.arrayContaining([
    expect.objectContaining({
      executable: 'deno',
      argv: ['test', '--no-lock', '--config', 'packages/platform-deno/deno/deno.json', '--allow-net', '--allow-read', 'packages/platform-deno/deno/native-adapter.test.js'],
    }),
  ]));
  expect(verifyJob.match(/needs: \[([^\]]+)\]/u)?.[1]?.split(',').map((name) => name.trim()))
    .toContain('verification');
  expect(verifyJob).toContain('node tooling/ci/verification-runner.mjs --plan .omo/ci-plan/plan.json --aggregate');
});
