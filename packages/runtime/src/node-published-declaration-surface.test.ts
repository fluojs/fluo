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
const consumerFixturePath = resolve(packageRootPath, 'src/node-static-assets-consumer.test-fixture.ts');

describe('@fluojs/runtime published Node static asset declarations', () => {
  beforeAll(async () => {
    if (existsSync(resolve(packageRootPath, 'dist/node.d.ts'))) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/runtime'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('type-checks a consumer fixture against the manifest-published Node declarations', () => {
    const program = ts.createProgram([consumerFixturePath], {
      baseUrl: packageRootPath,
      ignoreDeprecations: '6.0',
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      paths: {
        '@fluojs/runtime/node': ['dist/node.d.ts'],
      },
      strict: true,
      target: ts.ScriptTarget.ESNext,
      types: ['node'],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);

    expect(diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )).toEqual([]);
  }, 30_000);
});
