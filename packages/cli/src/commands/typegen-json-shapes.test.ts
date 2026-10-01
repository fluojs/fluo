import { dirname } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { TypegenCompiler } from './typegen-compiler.js';
import { TypegenCommandError } from './typegen-options.js';
import { projectJsonType } from './typegen-projection.js';

const modulePath = fileURLToPath(new URL('../fixtures/typegen-json-shapes.ts', import.meta.url));
const snapshot = TypegenCompiler.create({
  cwd: dirname(modulePath),
  modulePath,
  tsconfigPath: fileURLToPath(new URL('../fixtures/tsconfig.json', import.meta.url)),
});
function project(name: string) {
  const source = snapshot.sources.get(modulePath);
  if (source === undefined) throw new TypeError('The fixture must belong to the frozen compiler graph.');
  const declaration = source.statements.find((node) =>
    (ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name);
  if (declaration === undefined) throw new TypeError(`Missing fixture declaration ${name}.`);
  return projectJsonType({
    snapshot,
    type: snapshot.checker.getTypeAtLocation(declaration),
    node: declaration,
  });
}

describe('compiler limited JSON shape contract', () => {
  it('keeps an identical project fingerprint stable when its installation root moves', async () => {
    // Given: two project roots contain byte-identical source and compiler configuration.
    const parent = await mkdtemp(`${tmpdir()}/fluo-typegen-root-`);
    try {
      const fingerprints: string[] = [];
      for (const name of ['first', 'second']) {
        const cwd = `${parent}/${name}`;
        await mkdir(cwd);
        await writeFile(`${cwd}/app.ts`, 'import type { Local } from "@local"; export class AppModule { readonly name: Local = "same"; }\n');
        await writeFile(`${cwd}/local.ts`, 'export type Local = string;\n');
        await writeFile(`${cwd}/tsconfig.json`, JSON.stringify({
          compilerOptions: {
            target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
            paths: { '@local': ['./local.ts'] },
          },
          include: ['app.ts'],
        }));
        // When: the actual compiler freezes the same graph at each root.
        fingerprints.push(TypegenCompiler.create({
          cwd, modulePath: `${cwd}/app.ts`, tsconfigPath: `${cwd}/tsconfig.json`,
        }).fingerprint);
      }
      // Then: local absolute paths cannot make unchanged source stale after relocation.
      expect(fingerprints[0]).toBe(fingerprints[1]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('preserves finite nested, readonly-array and optional-property shapes', () => {
    // Given: actual compiler declarations express the supported plain-data subset.
    // When: the frozen compiler type is projected for the browser decoder.
    const shape = project('SupportedShape');
    // Then: aliases, optional omission and nested values remain explicit.
    expect(shape).toEqual({
      kind: 'object',
      fields: {
        title: { optional: false, shape: { kind: 'string' } },
        count: { optional: false, shape: { kind: 'number' } },
        active: { optional: false, shape: { kind: 'boolean' } },
        note: { optional: true, shape: { kind: 'string' } },
        tags: { optional: false, shape: { kind: 'array', item: { kind: 'string' } } },
        nested: { optional: false, shape: { kind: 'object', fields: {
          value: { optional: false, shape: { kind: 'null' } },
        } } },
      },
    });
  });

  it('retains discriminated unions without merging incompatible members', () => {
    // Given/When: both authored variants pass through the real compiler.
    const shape = project('SupportedUnion');
    // Then: each member has its own discriminant and concrete data contract.
    expect(shape).toMatchObject({ kind: 'union' });
    if (shape.kind !== 'union') throw new TypeError('Expected a projected union.');
    expect(shape.members).toHaveLength(2);
    expect(shape.members).toEqual(expect.arrayContaining([
      { kind: 'object', fields: {
        kind: { optional: false, shape: { kind: 'literal', value: 'ready' } },
        value: { optional: false, shape: { kind: 'string' } },
      } },
      { kind: 'object', fields: {
        kind: { optional: false, shape: { kind: 'literal', value: 'missing' } },
        value: { optional: false, shape: { kind: 'null' } },
      } },
    ]));
  });

  it('keeps unknown as validated JSON rather than an unchecked domain type', () => {
    // Given/When: unknown and an empty object retain different compiler meanings.
    // Then: the JSON boundary remains distinct from a finite empty-object decoder.
    expect(project('UnknownShape')).toEqual({ kind: 'json' });
    expect(project('EmptyShape')).toEqual({ kind: 'object', fields: {} });
  });

  it.each([
    'UntrustedAny', 'UnresolvedShape', 'TupleShape', 'OpenShape', 'FunctionShape',
    'MethodShape', 'SymbolShape', 'BigintShape', 'DateShape', 'CustomJsonShape',
    'RecursiveShape', 'InstanceShape',
  ])('rejects unsupported %s with a source-located diagnostic', (name) => {
    // Given: a real source declaration is outside the supported serialization contract.
    // When/Then: no schema or any downgrade is emitted, and correction has a source location.
    expect(() => project(name)).toThrow(TypegenCommandError);
    try {
      project(name);
    } catch (error) {
      if (!(error instanceof TypegenCommandError)) throw error;
      expect(error.message).toMatch(/typegen-json-shapes\.ts:\d+:\d+:/u);
    }
  });
});
