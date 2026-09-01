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
const consumerFixturePath = resolve(packageRootPath, 'src/byte-range-response-consumer.test-fixture.ts');

describe('@fluojs/http published byte range declarations', () => {
  beforeAll(async () => {
    if (
      existsSync(resolve(packageRootPath, 'dist/index.d.ts'))
      && existsSync(resolve(packageRootPath, 'dist/index.portable.d.ts'))
    ) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/http'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('type-checks a consumer fixture against the manifest-published root and portable declarations', () => {
    const program = ts.createProgram([consumerFixturePath], {
      baseUrl: packageRootPath,
      ignoreDeprecations: '6.0',
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      paths: {
        '@fluojs/http': ['dist/index.d.ts'],
        '@fluojs/http/portable': ['dist/index.portable.d.ts'],
      },
      strict: true,
      target: ts.ScriptTarget.ESNext,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);

    expect(diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )).toEqual([]);
  }, 30_000);
});
