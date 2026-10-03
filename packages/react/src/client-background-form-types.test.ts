import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

function compile(source: string): readonly ts.Diagnostic[] {
  const file = fileURLToPath(new URL('./background-consumer-fixture.ts', import.meta.url));
  const options: ts.CompilerOptions = {
    strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['node'],
    paths: { '@fluojs/react/client': [fileURLToPath(new URL('./client.ts', import.meta.url))] },
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, fresh) => name === file
    ? ts.createSourceFile(file, source, version, true) : original(name, version, onError, fresh);
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
}
const consumer = `
import { useForm, type ReactFormContract } from '@fluojs/react/client';
const decode = (value: unknown): { revision: number } => {
  if (typeof value !== 'object' || value === null) throw new TypeError('Missing object');
  const revision: unknown = Reflect.get(value, 'revision');
  if (typeof revision !== 'number') throw new TypeError('Invalid revision');
  return { revision };
};
const contract: ReactFormContract<{ q: string }, { revision: number }> = {
  fields: { q: 'q' }, decodeRead: decode, decodeSaved: decode,
};
const generated = useForm({
  id: 'search', action: '/search', mode: 'background', method: 'get', contract,
  allowDestination: () => false,
});
const handwritten = useForm({
  id: 'row', action: '/save', mode: 'background', method: 'post', fields: { q: 'q' },
  allowDestination: () => false,
});
`;
it('projects generated reads while handwritten data remains unknown under strict consumer flags', () => {
  // Given/When: the actual public hook consumes a validating generated contract.
  const diagnostics = compile(`${consumer}
if (generated.state.mutation?.status === 'read') {
  const revision: number = generated.state.mutation.data.revision;
}
const unknownData: unknown = handwritten.state.mutation;
generated.values('q');
useForm({ id: 'legacy', action: '/save', fields: { q: 'q' }, allowDestination: () => true });
`);
  // Then: no cast or alternate form API is required.
  expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
});
it.each([
  `useForm({ id: 'x', action: '/save', mode: 'fetcher', fields: { q: 'q' }, allowDestination: () => true });`,
  `useForm({ id: 'x', action: '/save', mode: 'background', method: 'put', fields: { q: 'q' }, allowDestination: () => true });`,
  `useForm({ id: 'x', action: '/save', mode: 'background', contract, fields: { q: 'q' }, allowDestination: () => true });`,
  `if (handwritten.state.mutation?.status === 'read') { const revision: number = handwritten.state.mutation.data.revision; }`,
  `if (generated.state.mutation?.status === 'read') { const revision: string = generated.state.mutation.data.revision; }`,
])('rejects a strict consumer bypass: %s', (invalid) => {
  // Given/When: a consumer supplies an unsupported shape or unvalidated data assumption.
  const diagnostics = compile(`${consumer}\n${invalid}`);
  // Then: the actual invalid consumer expression is rejected.
  expect(diagnostics.some((entry) => [2322, 2345, 2769, 18046].includes(entry.code))).toBe(true);
});
