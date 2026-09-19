import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repositoryRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const declarationTypesPath = resolve(packageRootPath, 'dist/types.d.ts');

function collectThreadIdDiagnostics(): readonly ts.Diagnostic[] {
  const consumerEntryPath = resolve(packageRootPath, 'dist/__fluo-thread-id-consumer__.ts');
  const consumerEntrySource = [
    "import type { DiscordNotificationPayload } from './index.js';",
    '',
    "const payload: DiscordNotificationPayload = { content: 'Deploy finished.', threadId: 'thread-release' };",
    'void payload;',
    '',
  ].join('\n');
  const compilerOptions: ts.CompilerOptions = {
    declaration: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);

  host.fileExists = ((fileName: string) =>
    resolve(fileName) === consumerEntryPath || ts.sys.fileExists(fileName)) as typeof host.fileExists;
  host.readFile = ((fileName: string) =>
    resolve(fileName) === consumerEntryPath ? consumerEntrySource : ts.sys.readFile(fileName)) as typeof host.readFile;
  host.getSourceFile = ((fileName: string, languageVersionOrOptions, ...rest) =>
    resolve(fileName) === consumerEntryPath
      ? ts.createSourceFile(consumerEntryPath, consumerEntrySource, languageVersionOrOptions, true, ts.ScriptKind.TS)
      : originalGetSourceFile(fileName, languageVersionOrOptions, ...rest)) as typeof host.getSourceFile;

  return ts.getPreEmitDiagnostics(ts.createProgram([consumerEntryPath], compilerOptions, host));
}

function getDiscordNotificationPayloadDeclaration(declarationText: string): ts.InterfaceDeclaration {
  const declaration = ts.createSourceFile(
    declarationTypesPath,
    declarationText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const payload = declaration.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === 'DiscordNotificationPayload',
  );

  if (!payload) {
    throw new Error('The emitted Discord declaration does not include DiscordNotificationPayload.');
  }

  return payload;
}

describe('@fluojs/discord published declaration surface', () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/discord'], {
      cwd: repositoryRootPath,
      env: process.env,
    });
  }, 300_000);

  it('rejects threadId as an excess property in a published Discord notification payload', () => {
    // Given: a strict consumer assigning a route-like value directly to the published payload type.
    // When: TypeScript resolves the built public declaration.
    const diagnostics = collectThreadIdDiagnostics();

    // Then: the only diagnostic is the exact excess-property rejection, not a tombstone type error.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(2353);
    expect(ts.flattenDiagnosticMessageText(diagnostics[0]?.messageText ?? '', '\n')).toBe(
      "Object literal may only specify known properties, and 'threadId' does not exist in type 'DiscordNotificationPayload'.",
    );
  });

  it('omits threadId from the emitted Discord notification payload declaration', () => {
    // Given: the cold-built declaration text consumed by published TypeScript users.
    const declarationText = readFileSync(declarationTypesPath, 'utf8');
    const payload = getDiscordNotificationPayloadDeclaration(declarationText);
    const payloadText = ts.createPrinter({ removeComments: true }).printNode(
      ts.EmitHint.Unspecified,
      payload,
      payload.getSourceFile(),
    );
    const propertyNames = payload.members
      .filter(ts.isPropertySignature)
      .map((property) => property.name?.getText(payload.getSourceFile()));

    // Then: neither emitted declaration text nor the interface key set publishes the removed route field.
    expect(payloadText).not.toContain('threadId');
    expect(propertyNames).not.toContain('threadId');
  });
});
