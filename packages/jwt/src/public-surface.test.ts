import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { DefaultJwtVerifier } from './signing/verifier.js';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const declarationRootPath = `${packageRootPath}/dist/index.d.ts`;

function collectRemovedAliasDiagnostics(): readonly ts.Diagnostic[] {
  const consumerFixturePath = resolve(packageRootPath, 'test/removed-verifier-alias-consumer.fixture.ts');
  const compilerOptions: ts.CompilerOptions = {
    baseUrl: packageRootPath,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    paths: {
      '@fluojs/jwt': ['dist/index.d.ts'],
    },
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };

  return ts.getPreEmitDiagnostics(ts.createProgram([consumerFixturePath], compilerOptions));
}

describe('@fluojs/jwt removed verifier alias public surface', () => {
  beforeAll(async () => {
    if (existsSync(declarationRootPath)) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/jwt'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('does not restore verifyAccessTokenWithOverrides at runtime', () => {
    const verifier = new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'secret' });

    expect('verifyAccessTokenWithOverrides' in verifier).toBe(false);
  });

  it('rejects a consumer that calls the removed alias from published declarations', () => {
    const aliasDiagnostics = collectRemovedAliasDiagnostics().filter((diagnostic) => diagnostic.code === 2339);

    expect(aliasDiagnostics).toHaveLength(1);
  }, 30_000);
});
