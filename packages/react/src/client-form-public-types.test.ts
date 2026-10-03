import ts from 'typescript';
import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Compile the real public source exports without reading or building shared dist.
// Installed declarations are exercised separately by the clean consumer typecheck.
const paths: Record<string, string[]> = {};
const packages = fileURLToPath(new URL('../../../packages/', import.meta.url));
function sourceExport(root: string, descriptor: unknown): string | undefined {
  if (typeof descriptor === 'string' && descriptor.startsWith('./dist/') && descriptor.endsWith('.js')) {
    const source = join(root, 'src', `${descriptor.slice(7, -3)}.ts`);
    return existsSync(source) ? source : undefined;
  }
  if (typeof descriptor === 'object' && descriptor !== null) {
    for (const value of Object.values(descriptor)) {
      const source = sourceExport(root, value);
      if (source !== undefined) return source;
    }
  }
  return undefined;
}
for (const directory of readdirSync(packages)) {
  const root = join(packages, directory);
  const manifestFile = join(root, 'package.json');
  if (!existsSync(manifestFile)) continue;
  const manifest: unknown = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (typeof manifest !== 'object' || manifest === null) continue;
  const name: unknown = Reflect.get(manifest, 'name');
  const exports: unknown = Reflect.get(manifest, 'exports');
  if (typeof name !== 'string' || typeof exports !== 'object' || exports === null) continue;
  for (const [subpath, descriptor] of Object.entries(exports)) {
    const source = sourceExport(root, descriptor);
    if (source !== undefined) paths[subpath === '.' ? name : `${name}/${subpath.slice(2)}`] = [source];
  }
  const index = join(root, 'src/index.ts');
  if (existsSync(index)) paths[name] = [index];
}

function compile(source: string): readonly ts.Diagnostic[] {
  const file = fileURLToPath(new URL('./form-consumer-fixture.ts', import.meta.url));
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['node'], paths,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, shouldCreateNewSourceFile) =>
    name === file ? ts.createSourceFile(file, source, version, true) : original(name, version, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([file], options, host);
  return ts.getPreEmitDiagnostics(program);
}

it('compiles typed successful input names and exhaustive mutation and follow-up outcomes', () => {
  const diagnostics = compile(`
    import { useForm, type ReactFormMutation, type ReactFormFollowUp } from '@fluojs/react/client';
    import { ReactModule, type ReactFormResult } from '@fluojs/react';
    const binding = useForm<{ name: string; tags: readonly string[] }>({
      id: 'product', action: '/save', fields: { name: 'display_name', tags: 'tag' },
      allowDestination: () => true,
    });
    const values: readonly string[] = binding.values('tags');
    const errors: readonly string[] = binding.fieldErrors('name');
    class ProductDto { name = ''; stock = 0; }
    const dto = useForm<ProductDto>({
      id: 'stock', action: '/stock', fields: { name: 'display_name', stock: 'quantity' },
      allowDestination: () => true,
    });
    const rawStock: readonly string[] = dto.values('stock');
    const result: ReactFormResult = ReactModule.formResult({ destination: '/products', followUp: 'navigate' });
    function mutation(value: ReactFormMutation): string {
      switch (value.status) {
        case 'saved': return value.destination;
        case 'read': return String(value.data);
        case 'validation': return value.formErrors.join(',');
        case 'error': case 'auth': case 'rejected': case 'uncertain': return value.reason;
        default: const impossible: never = value; return impossible;
      }
    }
    function read(value: ReactFormFollowUp): string {
      switch (value.status) {
        case 'pending': case 'complete': case 'cancelled': case 'document': return value.status;
        case 'error': return value.failure.reason;
        case 'rejected': return value.reason;
        default: const impossible: never = value; return impossible;
      }
    }
  `);
  expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
});

it.each([
  `binding.fieldErrors('password');`,
  `binding.values('password');`,
  `const result: 'saved' = value.status;`,
  `if (value.status === 'uncertain') { value.destination; }`,
  `if (value.status === 'saved') { value.fieldErrors; }`,
  `if (value.status === 'read') { const unvalidated: string = value.data; }`,
])('rejects an invalid consumer projection: %s', (invalid) => {
  const diagnostics = compile(`
    import { useForm, type ReactFormMutation } from '@fluojs/react/client';
    const binding = useForm<{ name: string }>({
      id: 'product', action: '/save', fields: { name: 'display_name' }, allowDestination: () => true,
    });
    declare const value: ReactFormMutation;
    ${invalid}
  `);
  expect(diagnostics.some((diagnostic) => [2345, 2322, 2339].includes(diagnostic.code))).toBe(true);
});
