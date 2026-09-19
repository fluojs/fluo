import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const packageDist = join(packageRoot, 'dist');
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workspaceBuildClosure = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const fixture = join(packageRoot, 'mapped-types-public-consumer.mts');
const mappedHelpers = ['PickType', 'OmitType', 'PartialType', 'IntersectionType'] as const;

function compileConsumer(source: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    paths: {
      '@fluojs/validation': [join(packageDist, 'index.d.ts')],
      '@fluojs/validation/mapped-types': [join(packageDist, 'mapped-types.d.ts')],
    },
    strict: true,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);

  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
}

describe('@fluojs/validation mapped-type public surface', () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, [workspaceBuildClosure, '@fluojs/validation'], {
      cwd: repositoryRoot,
      env: process.env,
      timeout: 240_000,
    });
  }, 300_000);

  it('keeps mapped helpers out of cold-built root declarations and runtime', async () => {
    const [rootDeclarations, rootRuntime] = await Promise.all([
      readFile(join(packageDist, 'index.d.ts'), 'utf8'),
      import(new URL('../dist/index.js', import.meta.url).href),
    ]);

    for (const helper of mappedHelpers) {
      expect(rootDeclarations).not.toContain(helper);
      expect(rootRuntime).not.toHaveProperty(helper);
    }
  });

  it('rejects root imports while accepting the canonical mapped-types subpath', () => {
    const rootDiagnostics = compileConsumer(
      `import { ${mappedHelpers.join(', ')} } from '@fluojs/validation';\nvoid [${mappedHelpers.join(', ')}];`,
    );
    const subpathDiagnostics = compileConsumer(
      `import { ${mappedHelpers.join(', ')} } from '@fluojs/validation/mapped-types';\nvoid [${mappedHelpers.join(', ')}];`,
    );

    expect(rootDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([2305, 2305, 2305, 2305]);
    expect(subpathDiagnostics).toEqual([]);
  });
});
