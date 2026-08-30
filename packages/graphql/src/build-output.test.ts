import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const packagePath = fileURLToPath(new URL('..', import.meta.url));
const workspaceBuildClosurePath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);

type ProcessResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

function runNodeProcess(args: readonly string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd });
    let stderr = '';
    let stdout = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stderr,
        stdout,
      });
    });
  });
}

it('boots the built ESM runtime while patching the mutable GraphQL helper owner', async () => {
  // Given
  const buildResult = await runNodeProcess(
    [workspaceBuildClosurePath, '@fluojs/graphql'],
    repoRootPath,
  );
  const driver = `
    import { Container } from '@fluojs/di';
    import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
    import { GraphqlLifecycleService } from './dist/service.js';

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        fields: {
          value: {
            resolve: () => 'value',
            type: GraphQLString,
          },
        },
        name: 'Query',
      }),
    });
    const adapter = {
      close: async () => {},
      listen: async () => {},
    };
    const logger = {
      debug: () => {},
      error: () => {},
      log: () => {},
      warn: () => {},
    };
    const service = new GraphqlLifecycleService(new Container(), [], logger, adapter, { schema });

    await service.onApplicationBootstrap();
    await service.onApplicationShutdown();
  `;

  // When
  const driverResult = await runNodeProcess(
    ['--input-type=module', '--eval', driver],
    packagePath,
  );

  // Then
  expect(buildResult.exitCode, [buildResult.stdout, buildResult.stderr].filter(Boolean).join('\n')).toBe(0);
  expect(driverResult.exitCode, [driverResult.stdout, driverResult.stderr].filter(Boolean).join('\n')).toBe(0);
}, 300_000);
