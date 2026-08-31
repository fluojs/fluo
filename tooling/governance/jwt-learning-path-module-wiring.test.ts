import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { enforceJwtLearningPathModuleWiring } from './jwt-learning-path-module-wiring.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function requireExecutableAuthModuleExample(markdown: string): ts.SourceFile {
  const example = Array.from(
    markdown.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/gu),
    (match) => match[1],
  ).find((candidate) =>
    candidate?.includes('export class AuthPersistenceModule') === true
      && candidate.includes('export class AuthModule') === true,
  );

  if (example === undefined) {
    throw new TypeError('Missing executable AuthPersistenceModule and AuthModule example.');
  }

  const source = ts.createSourceFile(
    'auth.module.ts',
    example,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const parseDiagnostics = (
    source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics !== undefined && parseDiagnostics.length > 0) {
    throw new TypeError('Auth module example must parse as TypeScript.');
  }

  return source;
}

function requireModuleMetadata(source: ts.SourceFile, className: string): ts.ObjectLiteralExpression {
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  const decorator = declaration === undefined
    ? undefined
    : ts.getDecorators(declaration)?.find((candidate) =>
      ts.isCallExpression(candidate.expression)
        && ts.isIdentifier(candidate.expression.expression)
        && candidate.expression.expression.text === 'Module',
    );

  if (
    decorator === undefined
    || !ts.isCallExpression(decorator.expression)
    || !ts.isObjectLiteralExpression(decorator.expression.arguments[0])
  ) {
    throw new TypeError(`${className} must use @Module({ ... }).`);
  }

  return decorator.expression.arguments[0];
}

function propertyText(metadata: ts.ObjectLiteralExpression, name: string): string {
  const property = metadata.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate)
        && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name))
        && candidate.name.text === name,
  );

  if (property === undefined) {
    throw new TypeError(`Module metadata is missing ${name}.`);
  }

  return property.initializer.getText();
}

describe('JWT Chapter 14 executable module wiring', () => {
  it.each([
    'book/beginner/ch14-jwt.md',
    'book/beginner/ch14-jwt.ko.md',
  ])('%s registers the durable auth graph with real module metadata', (relativePath) => {
    // Given
    const source = requireExecutableAuthModuleExample(read(relativePath));

    // When
    const persistence = requireModuleMetadata(source, 'AuthPersistenceModule');
    const auth = requireModuleMetadata(source, 'AuthModule');

    // Then
    expect(propertyText(persistence, 'global')).toBe('true');
    expect(propertyText(persistence, 'providers')).toContain('DatabaseRefreshTokenStore');
    expect(propertyText(persistence, 'providers')).toContain('provide: REFRESH_TOKEN_STORE');
    expect(propertyText(persistence, 'providers')).toContain('useExisting: DatabaseRefreshTokenStore');
    expect(propertyText(persistence, 'providers')).toContain('DatabaseCredentialsVerifier');
    expect(propertyText(persistence, 'providers')).toContain('provide: CREDENTIALS_VERIFIER');
    expect(propertyText(persistence, 'providers')).toContain('useExisting: DatabaseCredentialsVerifier');
    expect(propertyText(persistence, 'exports')).toContain('REFRESH_TOKEN_STORE');
    expect(propertyText(persistence, 'exports')).toContain('CREDENTIALS_VERIFIER');
    expect(propertyText(auth, 'imports')).toContain('ConfigModule.forRoot()');
    expect(propertyText(auth, 'imports')).toContain('AuthPersistenceModule');
    expect(propertyText(auth, 'imports')).toContain('inject: [ConfigService, REFRESH_TOKEN_STORE]');
    expect(propertyText(auth, 'providers')).toContain('AuthService');
    expect(propertyText(auth, 'controllers')).toContain('AuthController');
  });

  it('rejects a chapter that no longer exports the durable refresh-token token', () => {
    // Given
    const readWithoutRefreshTokenExport = (relativePath: string): string => {
      const content = read(relativePath);

      return relativePath === 'book/beginner/ch14-jwt.md'
        ? content.replace('exports: [REFRESH_TOKEN_STORE, CREDENTIALS_VERIFIER]', '')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceJwtLearningPathModuleWiring(readWithoutRefreshTokenExport);

    // Then
    expect(runGovernanceGuard).toThrow(/book\/beginner\/ch14-jwt\.md must include/);
  });
});
