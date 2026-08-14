import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  CallExpression,
  ClassDeclaration,
  MethodDeclaration,
  Node,
  ObjectLiteralExpression,
  SourceFile,
} from 'typescript';
import {
  canHaveDecorators,
  createSourceFile,
  DiagnosticCategory,
  flattenDiagnosticMessageText,
  forEachChild,
  getDecorators,
  isArrayLiteralExpression,
  isCallExpression,
  isClassDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSpreadElement,
  isStringLiteral,
  ModuleKind,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
  transpileModule,
} from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const passportReadmes = [
  'packages/passport/README.md',
  'packages/passport/README.ko.md',
] as const;
const passportChapters = [
  'book/beginner/ch15-passport.md',
  'book/beginner/ch15-passport.ko.md',
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
  const diagnostics = transpileModule(fence, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.Latest,
    },
    fileName: 'passport-learning-path.ts',
    reportDiagnostics: true,
  }).diagnostics?.filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error) ?? [];

  if (diagnostics.length > 0) {
    throw new TypeError(
      `Invalid TypeScript fence: ${diagnostics
        .map((diagnostic) => flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('; ')}`,
    );
  }

  return createSourceFile('passport-learning-path.ts', fence, ScriptTarget.Latest, true, ScriptKind.TS);
}

function isNamedPropertyAccess(node: Node, receiver: string, name: string): boolean {
  return isPropertyAccessExpression(node)
    && isIdentifier(node.expression)
    && node.expression.text === receiver
    && node.name.text === name;
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

function requireCall(source: SourceFile, callName: string): CallExpression {
  let call: CallExpression | undefined;

  function visit(node: Node): void {
    if (getCallName(node) === callName && isCallExpression(node)) {
      call = node;
    }

    forEachChild(node, visit);
  }

  visit(source);

  if (call === undefined) {
    throw new TypeError(`Missing call ${callName}`);
  }

  return call;
}

function getPropertyInitializer(object: ObjectLiteralExpression, name: string): Node | undefined {
  const property = object.properties.find(
    (candidate) => isPropertyAssignment(candidate) && candidate.name.getText() === name,
  );

  return property !== undefined && isPropertyAssignment(property) ? property.initializer : undefined;
}

function requireClass(source: SourceFile, name: string): ClassDeclaration {
  const declaration = source.statements.find(
    (statement): statement is ClassDeclaration =>
      isClassDeclaration(statement) && statement.name?.text === name,
  );

  if (declaration === undefined) {
    throw new TypeError(`Missing class ${name}`);
  }

  return declaration;
}

function requireMethod(declaration: ClassDeclaration, name: string): MethodDeclaration {
  const method = declaration.members.find(
    (member): member is MethodDeclaration => isMethodDeclaration(member) && member.name.getText() === name,
  );

  if (method === undefined) {
    throw new TypeError(`Missing method ${name}`);
  }

  return method;
}

function getDecoratorNames(node: Node): readonly string[] {
  if (!canHaveDecorators(node)) {
    return [];
  }

  return (getDecorators(node) ?? []).flatMap((decorator) => {
    const expression = decorator.expression;
    return isCallExpression(expression) && isIdentifier(expression.expression)
      ? [expression.expression.text]
      : [];
  });
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

  it.each(passportChapters)('%s co-locates authentication and scope enforcement', (relativePath) => {
    // Given
    const markdown = read(relativePath);

    // When
    const source = parseFence(requireTypeScriptFence(markdown, "RequireScopes('users:delete')"));
    const controller = requireClass(source, 'UsersController');
    const methodDecorators = getDecoratorNames(requireMethod(controller, 'deleteUser'));

    // Then
    expect(methodDecorators).toEqual(expect.arrayContaining(['UseAuth', 'RequireScopes']));
    expect(getDecoratorNames(controller)).not.toContain('UseAuth');
  });

  it.each(passportChapters)('%s registers the explicit Passport.js bridge bundle', (relativePath) => {
    // Given
    const markdown = read(relativePath);

    // When
    const source = parseFence(requireTypeScriptFence(markdown, 'createPassportJsStrategyBridge'));
    const bridgeCall = requireCall(source, 'createPassportJsStrategyBridge');
    const bridgeOptions = bridgeCall.arguments[2];
    const moduleMetadata = requireObjectArgument(source, 'Module');
    const providers = getPropertyInitializer(moduleMetadata, 'providers');
    const passportCall = requireCall(source, 'PassportModule.forRoot');
    const registrations = passportCall.arguments[1];

    // Then
    expect(isStringLiteral(bridgeCall.arguments[0]) && bridgeCall.arguments[0].text).toBe('google');
    expect(isIdentifier(bridgeCall.arguments[1]) && bridgeCall.arguments[1].text).toBe('GoogleStrategy');
    expect(
      bridgeOptions !== undefined
        && isObjectLiteralExpression(bridgeOptions)
        && getPropertyInitializer(bridgeOptions, 'mapPrincipal') !== undefined,
    ).toBe(true);
    expect(
      providers !== undefined
        && isArrayLiteralExpression(providers)
        && providers.elements.some(
          (element) => isIdentifier(element) && element.text === 'GoogleStrategy',
        )
        && providers.elements.some(
          (element) => isSpreadElement(element)
            && isNamedPropertyAccess(element.expression, 'googleBridge', 'providers'),
        ),
    ).toBe(true);
    expect(
      registrations !== undefined
        && isArrayLiteralExpression(registrations)
        && registrations.elements.some((element) =>
          isNamedPropertyAccess(element, 'googleBridge', 'strategy')),
    ).toBe(true);
  });

  it.each(passportChapters)('%s omits unsupported guard identifiers', (relativePath) => {
    // Given
    const markdown = read(relativePath);

    // When
    const staleGuardIdentifiers = markdown.match(/\b(?:RolesGuard|ScopesGuard)\b/g) ?? [];

    // Then
    expect(staleGuardIdentifiers).toEqual([]);
  });
});
