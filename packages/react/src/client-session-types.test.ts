import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

function compile(source: string): readonly ts.Diagnostic[] {
  const file = fileURLToPath(new URL('./session-consumer-fixture.ts', import.meta.url));
  const options: ts.CompilerOptions = {
    strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['node'],
    paths: {
      '@fluojs/react': [fileURLToPath(new URL('./index.ts', import.meta.url))],
      '@fluojs/react/client': [fileURLToPath(new URL('./client.ts', import.meta.url))],
    },
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, fresh) => name === file
    ? ts.createSourceFile(file, source, version, true) : original(name, version, onError, fresh);
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
}

const consumer = `
  import { ReactModule, type ReactSessionChange } from '@fluojs/react';
  import { useForm, type ReactFormContract } from '@fluojs/react/client';
  const contract: ReactFormContract<{ name: string }, { revision: number }> = {
    fields: { name: 'display_name' },
    decodeSaved(value) {
      if (typeof value !== 'object' || value === null) throw new TypeError('Missing saved object');
      const revision: unknown = Reflect.get(value, 'revision');
      if (typeof revision !== 'number') throw new TypeError('Invalid revision');
      return { revision };
    },
  };
  const binding = useForm({ id: 'product', action: '/save', contract, allowDestination: () => true });
  const result = ReactModule.formResult({
    destination: '/products', followUp: 'refresh', data: { revision: 2 },
    session: { epoch: 'session-b', reason: 'login' },
  });
`;

it('infers shared contract input and saved data while retaining form result literals', () => {
  // Given: the actual public form contract, not a copied consumer Input interface.
  // When: strict consumer code uses the existing creation and hook paths.
  const diagnostics = compile(`${consumer}
    const destination: '/products' = result.destination;
    const followUp: 'refresh' = result.followUp;
    const reason: 'login' = result.session.reason;
    const revision: 2 = result.data.revision;
    binding.values('name');
    if (binding.state.mutation?.status === 'saved' && binding.state.mutation.data !== undefined) {
      const saved: number = binding.state.mutation.data.revision;
    }
  `);
  // Then: fields and saved values infer from the shared contract.
  expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
});

it.each([
  `binding.values('password');`,
  `if (binding.state.mutation?.status === 'saved') { const saved: string = binding.state.mutation.data?.revision; }`,
  `const change: ReactSessionChange = { epoch: 'session-b', reason: 'forbidden' };`,
  `useForm({ id: 'x', action: '/save', contract, fields: { name: 'name' }, allowDestination: () => true });`,
])('rejects unsupported shared form consumer shape: %s', (invalid) => {
  // Given/When: an invalid public consumer attempts to bypass the declared contract.
  const diagnostics = compile(`${consumer}\n${invalid}`);
  // Then: type checking rejects the actual invalid expression.
  expect(diagnostics.some((entry) => [2322, 2345, 2769].includes(entry.code))).toBe(true);
});
