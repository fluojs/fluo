import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import ts from 'typescript';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { withWorkspaceArtifactSnapshot } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

import type {
  PrismaClientLike,
  PrismaAsyncModuleOptions as RootPrismaAsyncModuleOptions,
  PrismaPlatformStatusSnapshotInput as RootPrismaPlatformStatusSnapshotInput,
} from './index.js';
import * as prismaPublicApi from './index.js';
import type { PrismaAsyncModuleOptions as ModulePrismaAsyncModuleOptions } from './module.js';
import type { PrismaPlatformStatusSnapshotInput as StatusPrismaPlatformStatusSnapshotInput } from './status.js';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const packageDist = join(packageRoot, 'dist');
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
let consumerDirectory: string | undefined;

type PrismaPublicApiTestTransactionClient = {
  readonly transaction: true;
};

type PrismaPublicApiTestTransactionOptions = {
  readonly isolationLevel: 'serializable';
};

type PrismaPublicApiTestClient = PrismaClientLike<
  PrismaPublicApiTestTransactionClient,
  PrismaPublicApiTestTransactionOptions
>;

function compilePackageRootConsumer(source: string): readonly ts.Diagnostic[] {
  const fixture = join(packageRoot, 'public-api-negative-consumer.ts');
  const options: ts.CompilerOptions = {
    baseUrl: packageRoot,
    ignoreDeprecations: '6.0',
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    paths: {
      '@fluojs/prisma': [join(packageDist, 'index.d.ts')],
    },
    strict: true,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);

  return withWorkspaceArtifactSnapshot(['@fluojs/prisma'], repositoryRoot, () =>
    ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host)));
}

describe('@fluojs/prisma public API surface', () => {
  afterAll(async () => {
    if (consumerDirectory) {
      await rm(consumerDirectory, { force: true, recursive: true });
    }
  });

  it('keeps documented supported root-barrel exports', () => {
    expect(prismaPublicApi).toHaveProperty('PrismaModule');
    expect(prismaPublicApi).toHaveProperty('PrismaService');
    expect(prismaPublicApi).toHaveProperty('Transaction');
    expect(prismaPublicApi).toHaveProperty('createPrismaPlatformStatusSnapshot');
    expect(prismaPublicApi).toHaveProperty('PRISMA_CLIENT');
    expect(prismaPublicApi).toHaveProperty('PRISMA_OPTIONS');
    expect(prismaPublicApi).toHaveProperty('getPrismaClientToken');
    expect(prismaPublicApi).toHaveProperty('getPrismaOptionsToken');
    expect(prismaPublicApi).toHaveProperty('getPrismaServiceToken');
  });

  it('exposes module registration and explicit service request boundaries without wrapper-only APIs', () => {
    expect(prismaPublicApi.PrismaService).not.toHaveProperty('createFacade');
    expect(prismaPublicApi).not.toHaveProperty('PrismaTransactionInterceptor');
  });

  it('exports reusable async module and platform status input contracts', () => {
    expectTypeOf<RootPrismaAsyncModuleOptions<
      PrismaPublicApiTestClient,
      PrismaPublicApiTestTransactionClient,
      PrismaPublicApiTestTransactionOptions
    >>().toEqualTypeOf<ModulePrismaAsyncModuleOptions<
      PrismaPublicApiTestClient,
      PrismaPublicApiTestTransactionClient,
      PrismaPublicApiTestTransactionOptions
    >>();
    expectTypeOf<RootPrismaPlatformStatusSnapshotInput>()
      .toEqualTypeOf<StatusPrismaPlatformStatusSnapshotInput>();
  });

  it('does not expose internal module wiring values from the root barrel', () => {
    expect(prismaPublicApi).not.toHaveProperty('PRISMA_NORMALIZED_OPTIONS');
    expect(prismaPublicApi).not.toHaveProperty('normalizePrismaModuleOptions');
    expect(prismaPublicApi).not.toHaveProperty('createPrismaRuntimeProviders');
    expect(prismaPublicApi).not.toHaveProperty('createPrismaProviders');
  });

  it('keeps removed APIs and module wiring absent from cold-built package artifacts', async () => {
    await withWorkspaceArtifactSnapshot(['@fluojs/prisma'], repositoryRoot, async () => {
      // Given
      const [rootJavaScript, rootDeclarations, serviceJavaScript, serviceDeclarations] = await Promise.all([
        readFile(join(packageDist, 'index.js'), 'utf8'),
        readFile(join(packageDist, 'index.d.ts'), 'utf8'),
        readFile(join(packageDist, 'service.js'), 'utf8'),
        readFile(join(packageDist, 'service.d.ts'), 'utf8'),
      ]);

      // When
      consumerDirectory = await mkdtemp(join(packageRoot, '.fluo-prisma-public-api-'));
      const consumer = join(consumerDirectory, 'consumer.mjs');
      await writeFile(consumer, [
        "import * as prisma from '@fluojs/prisma';",
        "if ('PrismaTransactionInterceptor' in prisma) throw new Error('removed interceptor exported');",
        "if ('createPrismaServiceFacade' in prisma) throw new Error('internal facade factory exported');",
        "if ('createFacade' in prisma.PrismaService) throw new Error('removed static facade factory exported');",
      ].join('\n'));
      await execFileAsync(process.execPath, [consumer], { cwd: packageRoot });

      // Then
      for (const artifact of [rootJavaScript, rootDeclarations, serviceJavaScript, serviceDeclarations]) {
        expect(artifact).not.toContain('PrismaTransactionInterceptor');
        expect(artifact).not.toContain('createFacade');
      }
      expect(rootJavaScript).not.toContain('createPrismaServiceFacade');
      expect(rootDeclarations).not.toContain('createPrismaServiceFacade');
    });
  });

  it('rejects removed package-root imports and static facade access in built declarations', async () => {
    const state = new Int32Array(new SharedArrayBuffer(4));
    const writer = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const state = new Int32Array(workerData.buffer);
      const wait = Atomics.wait;
      Atomics.wait = (...args) => {
        Atomics.store(state, 0, 1); Atomics.notify(state, 0);
        return wait(...args);
      };
      parentPort.once('message', async () => {
        process.argv[1] = require('node:url').fileURLToPath(workerData.cleanUrl);
        process.argv[2] = workerData.dist;
        await import(workerData.cleanUrl);
        Atomics.store(state, 0, 2); Atomics.notify(state, 0);
        parentPort.close();
      });
    `, { eval: true, workerData: {
      buffer: state.buffer, dist: packageDist,
      cleanUrl: new URL('../../../tooling/scripts/clean-dist.mjs', import.meta.url).href,
    } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const exited = once(writer, 'exit', { signal: controller.signal });
    void exited.catch(() => {});
    try {
      await withWorkspaceArtifactSnapshot(['@fluojs/prisma'], repositoryRoot, async () => {
        writer.postMessage('attempt-clean');
        expect(Atomics.wait(state, 0, 0, 10_000)).not.toBe('timed-out');
        expect(Atomics.load(state, 0)).toBe(1);
        // Given
        const internalFactoryDiagnostics = compilePackageRootConsumer(
          "import { createPrismaServiceFacade } from '@fluojs/prisma';\nvoid createPrismaServiceFacade;",
        );
        const staticFacadeDiagnostics = compilePackageRootConsumer(
          "import { PrismaService } from '@fluojs/prisma';\nPrismaService.createFacade();",
        );

        // When
        const missingModuleDiagnostics = [...internalFactoryDiagnostics, ...staticFacadeDiagnostics]
          .filter((diagnostic) => diagnostic.code === 2307);

        // Then
        expect(missingModuleDiagnostics).toEqual([]);
        expect(internalFactoryDiagnostics.filter((diagnostic) => diagnostic.code === 2724)).toHaveLength(1);
        expect(staticFacadeDiagnostics.filter((diagnostic) => diagnostic.code === 2339)).toHaveLength(1);
      });
      expect((await exited)[0]).toBe(0);
      expect(Atomics.load(state, 0)).toBe(2);
    } finally {
      clearTimeout(timer);
      await writer.terminate();
    }
  });
});
