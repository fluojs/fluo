import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Node,
  ObjectLiteralExpression,
  SourceFile,
} from 'typescript';
import {
  createSourceFile,
  forEachChild,
  isArrayLiteralExpression,
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const passportReadmes = [
  'packages/passport/README.md',
  'packages/passport/README.ko.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function requireTypeScriptFence(markdown: string, governedIdentifier: string): string {
  const fences = Array.from(
    markdown.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g),
    (match) => match[1],
  ).filter((fence): fence is string => fence !== undefined);
  const fence = fences.find((candidate) => candidate.includes(governedIdentifier));

  if (fence === undefined) {
    throw new TypeError(`Missing TypeScript fence for ${governedIdentifier}`);
  }

  return fence;
}

function parseFence(fence: string): SourceFile {
  return createSourceFile('passport-learning-path.ts', fence, ScriptTarget.Latest, true, ScriptKind.TS);
}

function getCallName(node: Node): string | undefined {
  if (!isCallExpression(node)) {
    return undefined;
  }

  if (isIdentifier(node.expression)) {
    return node.expression.text;
  }

  if (isPropertyAccessExpression(node.expression) && isIdentifier(node.expression.expression)) {
    return `${node.expression.expression.text}.${node.expression.name.text}`;
  }

  return undefined;
}

function requireObjectArgument(source: SourceFile, callName: string): ObjectLiteralExpression {
  let objectArgument: ObjectLiteralExpression | undefined;

  function visit(node: Node): void {
    if (getCallName(node) === callName && isCallExpression(node)) {
      const argument = node.arguments[0];

      if (argument !== undefined && isObjectLiteralExpression(argument)) {
        objectArgument = argument;
      }
    }

    forEachChild(node, visit);
  }

  visit(source);

  if (objectArgument === undefined) {
    throw new TypeError(`Missing object argument for ${callName}`);
  }

  return objectArgument;
}

function getPropertyInitializer(object: ObjectLiteralExpression, name: string): Node | undefined {
  const property = object.properties.find(
    (candidate) => isPropertyAssignment(candidate) && candidate.name.getText() === name,
  );

  return property !== undefined && isPropertyAssignment(property) ? property.initializer : undefined;
}

describe('Passport authentication learning paths', () => {
  it.each(passportReadmes)('%s exposes the JWT verifier to the refresh strategy', (relativePath) => {
    // Given
    const markdown = read(relativePath);

    // When
    const source = parseFence(requireTypeScriptFence(markdown, 'RefreshTokenModule.forRoot'));
    const jwtOptions = requireObjectArgument(source, 'JwtModule.forRoot');

    // Then
    expect(getPropertyInitializer(jwtOptions, 'global')?.kind).toBe(SyntaxKind.TrueKeyword);
  });

  it.each(passportReadmes)('%s registers the refresh controller', (relativePath) => {
    // Given
    const markdown = read(relativePath);

    // When
    const source = parseFence(requireTypeScriptFence(markdown, 'RefreshTokenModule.forRoot'));
    const moduleMetadata = requireObjectArgument(source, 'Module');
    const controllers = getPropertyInitializer(moduleMetadata, 'controllers');

    // Then
    expect(
      controllers !== undefined
        && isArrayLiteralExpression(controllers)
        && controllers.elements.some((element) => isIdentifier(element) && element.text === 'AuthController'),
    ).toBe(true);
  });

});
