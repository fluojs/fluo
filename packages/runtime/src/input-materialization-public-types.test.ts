import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
let root: string;
let fixture: string;
const imports = `
import {
  Controller, createSchemaDto, FromBody, InputPolicy, Post, RequestDto,
  StandardSchemaBinder,
} from '@fluojs/http';
import {
  createSchemaDto as portableDto,
  InputPolicy as PortableInputPolicy,
  type SchemaDtoOptions,
} from '@fluojs/http/portable';
import { parseStandardSchema, type StandardSchemaV1Like } from '@fluojs/validation';
import type { BootstrapApplicationOptions } from '@fluojs/runtime';
const schema: StandardSchemaV1Like<{ title: string }, { title: string; count: number }> = {
  '~standard': {
    version: 1, vendor: 'consumer',
    validate: () => ({ value: { title: 'Draft', count: 2 } }),
  },
};
const Input = createSchemaDto(schema, { fields: { title: { source: 'body' } } });
`;

function compile(source: string, experimentalDecorators = false): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    experimentalDecorators,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixture], options, host);
  const declarations = program.getSourceFiles().filter((file) =>
    file.fileName.includes('/packages/') && file.fileName !== fixture,
  );
  expect(declarations.length).toBeGreaterThan(0);
  for (const declaration of declarations) {
    expect(declaration.fileName.startsWith(join(root, 'packages/'))).toBe(true);
    expect(declaration.isDeclarationFile).toBe(true);
  }
  return ts.getPreEmitDiagnostics(program);
}

function messages(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'));
}

describe('cold public input materialization declarations', () => {
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'fluo-input-3716-declarations-')));
    fixture = join(root, 'consumer/input-consumer.mts');
    const packages = resolveWorkspaceBuildOrder('@fluojs/runtime', repositoryRoot);
    const script = 'tooling/scripts/run-workspace-build-closure.mjs';
    for (const entry of [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
      'tooling/scripts/clean-dist.mjs', script,
      'packages/testing/src/babel-decorators-plugin.ts',
      ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
    ]) {
      await cp(join(repositoryRoot, entry), join(root, entry), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => !['dist', '.vite', '.vite-temp'].includes(basename(source)),
      });
    }
    await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    await mkdir(join(root, 'consumer/node_modules/@fluojs'), { recursive: true });
    for (const name of packages) {
      const packageRoot = join(root, 'packages', name.slice('@fluojs/'.length));
      expect(existsSync(join(packageRoot, 'dist'))).toBe(false);
      await symlink(packageRoot, join(root, 'consumer/node_modules', name), 'dir');
    }
    await execFileAsync(process.execPath, [join(root, script), '@fluojs/runtime'], {
      cwd: root,
      env: process.env,
      timeout: 240_000,
      killSignal: 'SIGTERM',
    });
  }, 300_000);

  it('infers schema output through manifest exports rather than workspace source aliases', () => {
    const diagnostics = compile(`${imports}
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Output = Assert<Equal<InstanceType<typeof Input>, { title: string; count: number }>>;
const parsed = parseStandardSchema(schema, { title: 'Draft' });
type Parsed = Assert<Equal<typeof parsed, Promise<{ title: string; count: number }>>>;
const options = { fields: { title: { source: 'body' } } } satisfies SchemaDtoOptions;
const Portable = portableDto(schema, options);
type PortableOutput = Assert<Equal<InstanceType<typeof Portable>, InstanceType<typeof Input>>>;
const scalarSchema: StandardSchemaV1Like<unknown, number> = {
  '~standard': { version: 1, vendor: 'consumer', validate: () => ({ value: 42 }) },
};
const Scalar = createSchemaDto(scalarSchema, { fields: {} });
type ScalarOutput = Assert<Equal<InstanceType<typeof Scalar>, number>>;
class App {}
const application: BootstrapApplicationOptions = {
  rootModule: App,
  binder: (fallback) => new StandardSchemaBinder(fallback),
};
InputPolicy({ unknownFields: 'strip', nonObjects: 'empty' });
`);
    expect(messages(diagnostics)).toEqual([]);
  });

  it('compiles standard class/method decorators, composition and body aliases', () => {
    const diagnostics = compile(`${imports}
@InputPolicy({ unknownFields: 'strip' })
class ClassInput {
  @FromBody('post_title')
  title = '';
}
function BoundPost(value: Function, context: ClassMethodDecoratorContext): void {
  InputPolicy({ unknownFields: 'strip' })(value, context);
  RequestDto(Input)(value, context);
  Post('/composed')(value, context);
}
@Controller('/posts')
class Posts {
  @InputPolicy({ unknownFields: 'strip' })
  @Post()
  @RequestDto(Input)
  create(input: InstanceType<typeof Input>) {
    const count: number = input.count;
    return count;
  }
  @Post('/reversed')
  @RequestDto(ClassInput)
  @PortableInputPolicy({ nonObjects: 'empty' })
  reversed(input: ClassInput) { return input.title; }
  @BoundPost
  composed(input: InstanceType<typeof Input>) { return input.count; }
}
`);
    expect(messages(diagnostics)).toEqual([]);
  });

  it('compiles actual legacy class/method decoration and three-argument composition', () => {
    const diagnostics = compile(`${imports}
const classDecorator: ClassDecorator = InputPolicy({ unknownFields: 'strip' });
const methodDecorator: MethodDecorator = InputPolicy({ nonObjects: 'empty' });
function Projected(): ClassDecorator & MethodDecorator {
  return PortableInputPolicy({ unknownFields: 'strip' });
}
function ComposedPolicy(): MethodDecorator {
  const policy = InputPolicy({ unknownFields: 'reject' });
  return (target, propertyKey, descriptor) => {
    policy(target, propertyKey, descriptor);
  };
}
@InputPolicy({ unknownFields: 'strip' })
class LegacyInput { title = ''; }
@Projected()
class LegacyPosts {
  @InputPolicy({ nonObjects: 'empty' })
  create(input: InstanceType<typeof Input>) { return input.count; }
  @Projected()
  projected(input: LegacyInput) { return input.title; }
  @ComposedPolicy()
  composed(input: InstanceType<typeof Input>) { return input.count; }
}
InputPolicy({ unknownFields: 'reject' })(
  LegacyPosts.prototype,
  'create',
  Object.getOwnPropertyDescriptor(LegacyPosts.prototype, 'create'),
);
`, true);
    expect(messages(diagnostics)).toEqual([]);
  });

  it('rejects input-shaped outputs and unsupported policies at the consumer', () => {
    const invalid = [
      "const output: InstanceType<typeof Input> = { title: 'Draft', count: '2' };",
      "InputPolicy({ unknownFields: 'allow' });",
      "InputPolicy({ nonObjects: 'ignore' });",
      "createSchemaDto(schema, { fields: { title: { source: 'cookie' } } });",
      "createSchemaDto(schema, { fields: { title: { source: 'query', repeatedQuery: 'join' } } });",
      "const app: BootstrapApplicationOptions = { rootModule: class App {}, binder: async (fallback) => fallback };",
    ];
    const diagnostics = compile(`${imports}${invalid.join('\n')}`);
    expect(diagnostics).toHaveLength(invalid.length);
    expect(diagnostics.every((entry) => entry.file?.fileName === fixture && entry.code === 2322))
      .toBe(true);
    expect(diagnostics.map((entry) =>
      entry.file && entry.start !== undefined
        ? entry.file.getLineAndCharacterOfPosition(entry.start).line
        : -1,
    )).toEqual(invalid.map((_, index) => imports.split('\n').length - 1 + index));
  });
});
