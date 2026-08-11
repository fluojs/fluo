import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { transformFileAsync } from '@babel/core';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const workspaceBuildClosurePath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const requiredArtifactPaths = [
  resolve(packageRootPath, 'dist/index.d.ts'),
  resolve(packageRootPath, 'dist/index.js'),
  resolve(packageRootPath, 'dist/openapi-module.js'),
  resolve(packageRootPath, 'dist/schema-builder.js'),
] as const;
const babelConfigPath = resolve(repoRootPath, 'tooling/babel/babel.config.cjs');
const publishedRuntimePairs = [
  {
    runtimePath: resolve(packageRootPath, 'dist/openapi-module.js'),
    sourcePath: resolve(packageRootPath, 'src/openapi-module.ts'),
  },
  {
    runtimePath: resolve(packageRootPath, 'dist/schema-builder.js'),
    sourcePath: resolve(packageRootPath, 'src/schema-builder.ts'),
  },
] as const;
const publishedResultMarker = 'FLUO_OPENAPI_PUBLISHED_CONTRACT_RESULT=' as const;

function normalizeRuntimeAst(sourceText: string, filePath: string): string {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

  return ts
    .createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
    .printFile(sourceFile);
}

const publishedContractProbe = `
  const { OpenApiModule } = await import('@fluojs/openapi');
  const { bootstrapApplication, defineModule } = await import('@fluojs/runtime');

  const createRequest = (path) => ({
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  });
  const createResponse = () => ({
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
  });

  class AppModule {}

  defineModule(AppModule, {
    imports: [
      OpenApiModule.forRoot({
        documentPath: '//contracts//openapi.json/',
        documentTransform: (document) => ({
          ...document,
          components: {
            schemas: {
              PublishedContract: {
                nullable: true,
                type: 'string',
              },
            },
          },
        }),
        title: 'Published Contract API',
        ui: true,
        uiPath: '/contracts//docs/',
        version: '1.0.0',
      }),
    ],
  });

  const app = await bootstrapApplication({ rootModule: AppModule });

  try {
    const documentResponse = createResponse();
    const uiResponse = createResponse();

    await app.dispatch(createRequest('/contracts/openapi.json'), documentResponse);
    await app.dispatch(createRequest('/contracts/docs'), uiResponse);

    process.stdout.write(${JSON.stringify(publishedResultMarker)} + JSON.stringify({
      documentBody: documentResponse.body,
      documentStatus: documentResponse.statusCode,
      uiBody: uiResponse.body,
      uiStatus: uiResponse.statusCode,
    }) + '\\n');
  } finally {
    await app.close();
  }
`;

describe('@fluojs/openapi published contract', () => {
  beforeAll(async () => {
    if (requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
      return;
    }

    await execFileAsync(process.execPath, [workspaceBuildClosurePath, '@fluojs/openapi'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('keeps published runtime implementations aligned with source', async () => {
    // Given
    expect(requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))).toBe(true);

    // When
    const runtimeComparisons = await Promise.all(publishedRuntimePairs.map(async ({ runtimePath, sourcePath }) => {
      const transformedSource = await transformFileAsync(sourcePath, {
        babelrc: false,
        configFile: babelConfigPath,
      });

      if (typeof transformedSource?.code !== 'string') {
        throw new TypeError(`Babel did not emit ${sourcePath}.`);
      }

      return {
        emitted: normalizeRuntimeAst(transformedSource.code, sourcePath),
        published: normalizeRuntimeAst(readFileSync(runtimePath, 'utf8'), runtimePath),
      };
    }));

    // Then
    for (const comparison of runtimeComparisons) {
      expect(comparison.published).toBe(comparison.emitted);
    }
  });

  it('serves normalized custom routes and OpenAPI 3.1 schemas through the published root entrypoint', () => {
    // Given
    expect(requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))).toBe(true);

    // When
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', publishedContractProbe], {
      cwd: packageRootPath,
      encoding: 'utf8',
    });
    const serializedResult = result.stdout
      .split('\n')
      .find((line) => line.startsWith(publishedResultMarker));

    // Then
    expect(result.status, [result.stdout, result.stderr].filter(Boolean).join('\n')).toBe(0);
    expect(serializedResult, result.stdout).toBeDefined();
    const publishedResult: unknown = JSON.parse(serializedResult?.slice(publishedResultMarker.length) ?? 'null');

    expect(publishedResult).toMatchObject({
      documentBody: {
        components: {
          schemas: {
            PublishedContract: {
              type: ['string', 'null'],
            },
          },
        },
        info: {
          title: 'Published Contract API',
          version: '1.0.0',
        },
      },
      documentStatus: 200,
      uiStatus: 200,
    });
    expect(publishedResult).not.toEqual(expect.objectContaining({
      documentBody: expect.objectContaining({
        components: expect.objectContaining({
          schemas: expect.objectContaining({
            PublishedContract: expect.objectContaining({ nullable: true }),
          }),
        }),
      }),
    }));
    expect(publishedResult).toEqual(expect.objectContaining({
      uiBody: expect.stringContaining('/contracts/openapi.json'),
    }));
  });
});
