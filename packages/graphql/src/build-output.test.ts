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
    import { createRequire } from 'node:module';
    import { Container } from '@fluojs/di';
    import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
    import { installGraphqlInstanceOfPatch } from './dist/instance-of-patch.js';
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

    const runtimeRequire = createRequire(import.meta.url);
    const instanceOfModule = runtimeRequire('graphql/jsutils/instanceOf.js');
    const originalInstanceOf = instanceOfModule.instanceOf;

    for (const [firstRelease, secondRelease] of [['first', 'second'], ['second', 'first']]) {
      const firstCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
      const secondCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
      const releaseFirstPatch = installGraphqlInstanceOfPatch(
        instanceOfModule,
        new WeakSet([firstCrossRealmSchema]),
      );
      const capturedFluoPatch = instanceOfModule.instanceOf;
      const externalWrapper = (value, constructor) => capturedFluoPatch(value, constructor);

      instanceOfModule.instanceOf = externalWrapper;
      const releaseSecondPatch = installGraphqlInstanceOfPatch(
        instanceOfModule,
        new WeakSet([secondCrossRealmSchema]),
      );
      const releases = {
        first: releaseFirstPatch,
        second: releaseSecondPatch,
      };

      if (instanceOfModule.instanceOf({}, GraphQLSchema) !== false) {
        throw new Error('ordinary object must not recurse through the external wrapper');
      }
      if (
        !instanceOfModule.instanceOf(firstCrossRealmSchema, GraphQLSchema) ||
        !instanceOfModule.instanceOf(secondCrossRealmSchema, GraphQLSchema)
      ) {
        throw new Error('both active cross-realm allowlists must remain available');
      }

      releases[firstRelease]();
      const activeCrossRealmSchema = firstRelease === 'first'
        ? secondCrossRealmSchema
        : firstCrossRealmSchema;
      if (!instanceOfModule.instanceOf(activeCrossRealmSchema, GraphQLSchema)) {
        throw new Error('remaining active allowlist must stay patched');
      }
      if (instanceOfModule.instanceOf === externalWrapper) {
        throw new Error('external wrapper must not be restored while an owner remains');
      }

      releases[secondRelease]();
      if (instanceOfModule.instanceOf !== externalWrapper) {
        throw new Error('external wrapper identity must be restored after the final release');
      }
      instanceOfModule.instanceOf = originalInstanceOf;
    }

    for (const [firstRelease, secondRelease] of [['first', 'second'], ['second', 'first']]) {
      const firstManager = await import('./dist/instance-of-patch.js?module-copy=first');
      const secondManager = await import('./dist/instance-of-patch.js?module-copy=second');
      const copiedOwner = { instanceOf: () => false };
      const copiedOwnerOriginalInstanceOf = copiedOwner.instanceOf;
      const firstCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
      const secondCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
      const releaseFirstPatch = firstManager.installGraphqlInstanceOfPatch(
        copiedOwner,
        new WeakSet([firstCrossRealmSchema]),
      );
      const releaseSecondPatch = secondManager.installGraphqlInstanceOfPatch(
        copiedOwner,
        new WeakSet([secondCrossRealmSchema]),
      );
      const releases = {
        first: releaseFirstPatch,
        second: releaseSecondPatch,
      };

      releases[firstRelease]();
      const activeCrossRealmSchema = firstRelease === 'first'
        ? secondCrossRealmSchema
        : firstCrossRealmSchema;
      if (!copiedOwner.instanceOf(activeCrossRealmSchema, GraphQLSchema)) {
        throw new Error('remaining copied-manager owner must keep its allowlist');
      }

      releases[secondRelease]();
      if (copiedOwner.instanceOf !== copiedOwnerOriginalInstanceOf) {
        throw new Error('original owner identity must be restored after copied-manager releases');
      }
    }
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
