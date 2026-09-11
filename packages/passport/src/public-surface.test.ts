import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const declarationRootPath = `${packageRootPath}/dist/index.d.ts`;

function collectRemovedRefreshExportDiagnostics(fixtureName: string): readonly ts.Diagnostic[] {
  const consumerFixturePath = resolve(packageRootPath, 'test', fixtureName);
  const compilerOptions: ts.CompilerOptions = {
    baseUrl: packageRootPath,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    paths: {
      '@fluojs/passport': ['dist/index.d.ts'],
    },
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };

  return ts.getPreEmitDiagnostics(ts.createProgram([consumerFixturePath], compilerOptions));
}

describe('@fluojs/passport removed refresh exports public surface', () => {
  beforeAll(async () => {
    if (existsSync(declarationRootPath)) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/passport'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('does not restore adapter-owned refresh exports at runtime', async () => {
    const passport = await import('../dist/index.js');

    expect('JwtRefreshTokenAdapter' in passport).toBe(false);
    expect('REFRESH_TOKEN_MODULE_OPTIONS' in passport).toBe(false);
  });

  it('rejects consumers of removed refresh declarations', () => {
    const fixtureNames = [
      'removed-jwt-refresh-token-adapter-consumer.fixture.ts',
      'removed-refresh-token-module-options-consumer.fixture.ts',
      'removed-refresh-token-module-options-type-consumer.fixture.ts',
      'removed-refresh-token-service-consumer.fixture.ts',
    ];
    const removedExportDiagnostics = fixtureNames.flatMap((fixtureName) => (
      collectRemovedRefreshExportDiagnostics(fixtureName).filter(
        (diagnostic) => diagnostic.code === 2305 || diagnostic.code === 2724,
      )
    ));

    expect(removedExportDiagnostics).toHaveLength(4);
  }, 30_000);
});
