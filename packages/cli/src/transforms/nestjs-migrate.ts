import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

import ts from 'typescript';

export const MIGRATION_TRANSFORMS = ['imports', 'injectable', 'scope', 'bootstrap', 'testing', 'tsconfig'] as const;

export type MigrationTransformKind = typeof MIGRATION_TRANSFORMS[number];

type ImportBinding = {
  imported: string;
  local: string;
};

export type MigrationWarning = {
  filePath: string;
  line: number;
  message: string;
};

export type FileMigrationResult = {
  appliedTransforms: MigrationTransformKind[];
  changed: boolean;
  filePath: string;
  warnings: MigrationWarning[];
};

export type MigrationReport = {
  apply: boolean;
  changedFiles: number;
  scannedFiles: number;
  warningCount: number;
  fileResults: FileMigrationResult[];
};

export type RunNestJsMigrationOptions = {
  apply: boolean;
  enabledTransforms: ReadonlySet<MigrationTransformKind>;
  targetPath: string;
};

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

const NEST_COMMON_TO_KONEKTI: Record<string, '@konekti/core' | '@konekti/http'> = {
  Body: '@konekti/http',
  ConflictException: '@konekti/http',
  Controller: '@konekti/http',
  Delete: '@konekti/http',
  ForbiddenException: '@konekti/http',
  Get: '@konekti/http',
  Header: '@konekti/http',
  Headers: '@konekti/http',
  HttpCode: '@konekti/http',
  HttpException: '@konekti/http',
  Inject: '@konekti/core',
  Module: '@konekti/core',
  NotFoundException: '@konekti/http',
  Param: '@konekti/http',
  Patch: '@konekti/http',
  Post: '@konekti/http',
  Put: '@konekti/http',
  Query: '@konekti/http',
  Req: '@konekti/http',
  Res: '@konekti/http',
  Scope: '@konekti/core',
  UnauthorizedException: '@konekti/http',
  UseGuards: '@konekti/http',
  UseInterceptors: '@konekti/http',
};

const REQUEST_DTO_DECORATORS = new Set(['Body', 'Param', 'Query']);

const TRANSFORM_KIND_LABEL: Record<MigrationTransformKind, string> = {
  bootstrap: 'bootstrap rewrite',
  imports: 'import rewriting',
  injectable: '@Injectable removal',
  scope: 'scope mapping',
  testing: 'testing rewrite',
  tsconfig: 'tsconfig rewrite',
};

function parseSource(source: string, filePath: string): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function buildWarning(filePath: string, sourceFile: ts.SourceFile, node: ts.Node, message: string): MigrationWarning {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  return { filePath, line, message };
}

function getImportBindings(importDeclaration: ts.ImportDeclaration): ImportBinding[] {
  const importClause = importDeclaration.importClause;
  if (!importClause || !importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
    return [];
  }

  return importClause.namedBindings.elements.map((element) => ({
    imported: (element.propertyName ?? element.name).text,
    local: element.name.text,
  }));
}

function createImportSpecifier(binding: ImportBinding): ts.ImportSpecifier {
  if (binding.imported === binding.local) {
    return ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(binding.local));
  }

  return ts.factory.createImportSpecifier(
    false,
    ts.factory.createIdentifier(binding.imported),
    ts.factory.createIdentifier(binding.local),
  );
}

function toBindingKey(binding: ImportBinding): string {
  return `${binding.imported}::${binding.local}`;
}

function updateNamedImports(importDeclaration: ts.ImportDeclaration, bindings: ImportBinding[]): ts.ImportDeclaration | undefined {
  const importClause = importDeclaration.importClause;
  if (!importClause || !importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
    return importDeclaration;
  }

  if (bindings.length === 0 && !importClause.name) {
    return undefined;
  }

  const updatedClause = ts.factory.updateImportClause(
    importClause,
    importClause.isTypeOnly,
    importClause.name,
    bindings.length > 0 ? ts.factory.createNamedImports(bindings.map(createImportSpecifier)) : undefined,
  );

  return ts.factory.updateImportDeclaration(
    importDeclaration,
    importDeclaration.modifiers,
    updatedClause,
    importDeclaration.moduleSpecifier,
    importDeclaration.attributes,
  );
}

function mergeNamedImport(statements: ts.Statement[], moduleSpecifier: string, newBindings: ImportBinding[]): ts.Statement[] {
  if (newBindings.length === 0) {
    return statements;
  }

  const deduped = new Map<string, ImportBinding>();
  for (const binding of newBindings) {
    deduped.set(toBindingKey(binding), binding);
  }

  let merged = false;
  const updated = statements.map((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== moduleSpecifier) {
      return statement;
    }

    const existingBindings = getImportBindings(statement);
    for (const binding of existingBindings) {
      deduped.set(toBindingKey(binding), binding);
    }

    merged = true;
    const mergedBindings = [...deduped.values()].sort((left, right) => left.local.localeCompare(right.local));
    return updateNamedImports(statement, mergedBindings) ?? statement;
  });

  if (merged) {
    return updated;
  }

  const importDeclaration = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([...deduped.values()].sort((left, right) => left.local.localeCompare(right.local)).map(createImportSpecifier)),
    ),
    ts.factory.createStringLiteral(moduleSpecifier),
  );

  const importIndexes = updated
    .map((statement, index) => ({ index, isImport: ts.isImportDeclaration(statement) }))
    .filter((entry) => entry.isImport)
    .map((entry) => entry.index);

  if (importIndexes.length === 0) {
    return [importDeclaration, ...updated];
  }

  const insertIndex = importIndexes[importIndexes.length - 1] + 1;
  return [...updated.slice(0, insertIndex), importDeclaration, ...updated.slice(insertIndex)];
}

function printSourceFile(sourceFile: ts.SourceFile, statements: ts.Statement[]): string {
  const updated = ts.factory.updateSourceFile(sourceFile, statements);
  return printer.printFile(updated);
}

function removeImportBinding(
  source: string,
  sourceFilePath: string,
  moduleSpecifier: string,
  importedName: string,
): { changed: boolean; source: string } {
  const sourceFile = parseSource(source, sourceFilePath);
  let changed = false;
  const statements: ts.Statement[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== moduleSpecifier) {
      statements.push(statement);
      continue;
    }

    const bindings = getImportBindings(statement);
    if (bindings.length === 0) {
      statements.push(statement);
      continue;
    }

    const filtered = bindings.filter((binding) => binding.imported !== importedName);
    if (filtered.length !== bindings.length) {
      changed = true;
    }

    const updated = updateNamedImports(statement, filtered);
    if (updated) {
      statements.push(updated);
    }
  }

  if (!changed) {
    return { changed: false, source };
  }

  return {
    changed: true,
    source: printSourceFile(sourceFile, statements),
  };
}

function rewriteImports(source: string, filePath: string): { changed: boolean; source: string; warnings: MigrationWarning[] } {
  const sourceFile = parseSource(source, filePath);
  const warnings: MigrationWarning[] = [];
  const additions = new Map<string, ImportBinding[]>();
  const statements: ts.Statement[] = [];
  let touched = false;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      statements.push(statement);
      continue;
    }

    if (statement.moduleSpecifier.text !== '@nestjs/common') {
      statements.push(statement);
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause || !importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
      warnings.push(buildWarning(filePath, sourceFile, statement, 'Unsupported Nest import form detected. Review this import manually.'));
      statements.push(statement);
      continue;
    }

    const remaining: ImportBinding[] = [];

    for (const binding of getImportBindings(statement)) {
      const targetModule = NEST_COMMON_TO_KONEKTI[binding.imported];
      if (!targetModule) {
        remaining.push(binding);
        continue;
      }

      touched = true;
      const moduleBindings = additions.get(targetModule) ?? [];
      moduleBindings.push({ imported: binding.imported, local: binding.local });
      additions.set(targetModule, moduleBindings);
    }

    const updated = updateNamedImports(statement, remaining);
    if (updated) {
      statements.push(updated);
    }
  }

  if (!touched) {
    return {
      changed: false,
      source,
      warnings,
    };
  }

  let nextStatements = statements;
  for (const [moduleSpecifier, bindings] of additions.entries()) {
    nextStatements = mergeNamedImport(nextStatements, moduleSpecifier, bindings);
  }

  const nextSource = printSourceFile(sourceFile, nextStatements);
  return {
    changed: nextSource !== source,
    source: nextSource,
    warnings,
  };
}

function isDecoratorNamed(decorator: ts.Decorator, name: string): boolean {
  if (!ts.isCallExpression(decorator.expression)) {
    return false;
  }

  return ts.isIdentifier(decorator.expression.expression) && decorator.expression.expression.text === name;
}

function hasScopeDecorator(modifiers: readonly ts.ModifierLike[] | undefined): boolean {
  if (!modifiers) {
    return false;
  }

  return modifiers.some((modifier) => ts.isDecorator(modifier) && isDecoratorNamed(modifier, 'Scope'));
}

function hasDecoratorNamed(modifiers: readonly ts.ModifierLike[] | undefined, name: string): boolean {
  if (!modifiers) {
    return false;
  }

  return modifiers.some((modifier) => ts.isDecorator(modifier) && isDecoratorNamed(modifier, name));
}

function hasConflictingScopeImport(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !statement.importClause.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) {
      continue;
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text === '@konekti/core') {
      continue;
    }

    if (statement.importClause.namedBindings.elements.some((element) => element.name.text === 'Scope')) {
      return true;
    }
  }

  return false;
}

function readInjectableScope(argument: ts.Expression | undefined): 'singleton' | 'request' | 'transient' | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return undefined;
  }

  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    if (!ts.isIdentifier(property.name) || property.name.text !== 'scope') {
      continue;
    }

    const value = property.initializer.getText();
    if (value === 'Scope.REQUEST') {
      return 'request';
    }

    if (value === 'Scope.TRANSIENT') {
      return 'transient';
    }

    if (value === 'Scope.DEFAULT') {
      return 'singleton';
    }
  }

  return undefined;
}

function rewriteInjectableAndScope(
  source: string,
  filePath: string,
  options: { removeInjectable: boolean; rewriteScope: boolean },
): { changed: boolean; source: string; warnings: MigrationWarning[] } {
  if ((!options.removeInjectable && !options.rewriteScope) || !source.includes('@Injectable')) {
    return {
      changed: false,
      source,
      warnings: [],
    };
  }

  const sourceFile = parseSource(source, filePath);
  const warnings: MigrationWarning[] = [];
  let hasStructuralChange = false;
  let addedScopeDecorator = false;
  const scopeDecoratorName = hasConflictingScopeImport(sourceFile) ? 'KonektiScope' : 'Scope';

  const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
    const visit = (node: ts.Node): ts.Node => {
      if (!ts.isClassDeclaration(node) || !node.modifiers) {
        return ts.visitEachChild(node, visit, context);
      }

      let classUpdated = false;
      let sawInjectableDecorator = false;
      let mappedScope: 'singleton' | 'request' | 'transient' | undefined;
      const nextModifiers: ts.ModifierLike[] = [];

      for (const modifier of node.modifiers) {
        if (!ts.isDecorator(modifier) || !ts.isCallExpression(modifier.expression)) {
          nextModifiers.push(modifier);
          continue;
        }

        if (!ts.isIdentifier(modifier.expression.expression) || modifier.expression.expression.text !== 'Injectable') {
          nextModifiers.push(modifier);
          continue;
        }

        sawInjectableDecorator = true;
        const [firstArgument] = modifier.expression.arguments;

        if (options.rewriteScope) {
          mappedScope = readInjectableScope(firstArgument);
        }

        if (!options.removeInjectable) {
          nextModifiers.push(modifier);
          continue;
        }

        classUpdated = true;
        hasStructuralChange = true;

        if (firstArgument && ts.isObjectLiteralExpression(firstArgument)) {
          const unsupportedProperties = firstArgument.properties.filter((property) => !ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || property.name.text !== 'scope');
          if (unsupportedProperties.length > 0) {
            warnings.push(
              buildWarning(
                filePath,
                sourceFile,
                modifier,
                '@Injectable options other than scope were removed. Verify behavior manually.',
              ),
            );
          }
        }
      }

      if (!sawInjectableDecorator) {
        return ts.visitEachChild(node, visit, context);
      }

      if (options.rewriteScope && mappedScope && !hasScopeDecorator(nextModifiers) && !hasDecoratorNamed(nextModifiers, scopeDecoratorName)) {
        classUpdated = true;
        hasStructuralChange = true;
        addedScopeDecorator = true;
        nextModifiers.unshift(
          ts.factory.createDecorator(
            ts.factory.createCallExpression(ts.factory.createIdentifier(scopeDecoratorName), undefined, [ts.factory.createStringLiteral(mappedScope)]),
          ),
        );
      }

      if (!classUpdated) {
        return ts.visitEachChild(node, visit, context);
      }

      return ts.factory.updateClassDeclaration(
        node,
        nextModifiers.length > 0 ? nextModifiers : undefined,
        node.name,
        node.typeParameters,
        node.heritageClauses,
        node.members,
      );
    };

    return (node: T) => ts.visitNode(node, visit);
  };

  const transformed = ts.transform(sourceFile, [transformer]).transformed[0] as ts.SourceFile;
  if (!hasStructuralChange) {
    return {
      changed: false,
      source,
      warnings,
    };
  }

  let nextSource = printer.printFile(transformed);

  if (options.rewriteScope && addedScopeDecorator) {
    const nextSourceFile = parseSource(nextSource, filePath);
    nextSource = printSourceFile(
      nextSourceFile,
      mergeNamedImport([...nextSourceFile.statements], '@konekti/core', [{ imported: 'Scope', local: scopeDecoratorName }]),
    );
  }

  if (options.removeInjectable) {
    const withoutInjectableImport = removeImportBinding(nextSource, filePath, '@nestjs/common', 'Injectable');
    nextSource = withoutInjectableImport.source;
  }

  return {
    changed: nextSource !== source,
    source: nextSource,
    warnings,
  };
}

function rewriteBootstrap(source: string, filePath: string): { changed: boolean; source: string; warnings: MigrationWarning[] } {
  const sourceFile = parseSource(source, filePath);
  const warnings: MigrationWarning[] = [];
  const createCalls = new Map<string, ts.CallExpression>();
  const listenCalls = new Map<string, ts.CallExpression>();
  const portFoldedApps = new Set<string>();
  const rewrittenCreateCallKeys = new Set<string>();
  const warnedCreateCallKeys = new Set<string>();

  function toCallKey(callExpression: ts.CallExpression): string {
    return `${callExpression.pos}:${callExpression.end}`;
  }

  function warnUnsupportedCreate(callExpression: ts.CallExpression, reason: string): void {
    const key = toCallKey(callExpression);
    if (warnedCreateCallKeys.has(key)) {
      return;
    }

    warnedCreateCallKeys.add(key);
    warnings.push(buildWarning(filePath, sourceFile, callExpression, `${reason} Keep this Nest bootstrap path and migrate manually.`));
  }

  function isSupportedCreateCall(callExpression: ts.CallExpression): { supported: true } | { supported: false; reason: string } {
    if (callExpression.typeArguments && callExpression.typeArguments.length > 0) {
      return {
        reason: 'Unsupported NestFactory.create type-argument usage.',
        supported: false,
      };
    }

    if (callExpression.arguments.length === 0 || callExpression.arguments.length > 2) {
      return {
        reason: 'Unsupported NestFactory.create argument shape.',
        supported: false,
      };
    }

    if (callExpression.arguments.length === 2 && !ts.isObjectLiteralExpression(callExpression.arguments[1])) {
      return {
        reason: 'Unsupported NestFactory.create adapter-specific startup form.',
        supported: false,
      };
    }

    return { supported: true };
  }

  const inspect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (
        ts.isIdentifier(node.name)
        && ts.isCallExpression(initializer)
        && ts.isPropertyAccessExpression(initializer.expression)
        && ts.isIdentifier(initializer.expression.expression)
        && initializer.expression.expression.text === 'NestFactory'
        && initializer.expression.name.text === 'create'
      ) {
        createCalls.set(node.name.text, initializer);
      }
    }

    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.name.text === 'listen'
    ) {
      listenCalls.set(node.expression.expression.text, node);
    }

    ts.forEachChild(node, inspect);
  };

  inspect(sourceFile);

  const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'NestFactory' && node.expression.name.text === 'create') {
          const support = isSupportedCreateCall(node);
          if (!support.supported) {
            warnUnsupportedCreate(node, support.reason);
            return node;
          }

          let nextArgs = [...node.arguments];
          const ownerEntry = [...createCalls.entries()].find(([, callExpression]) => callExpression.pos === node.pos && callExpression.end === node.end);

          if (ownerEntry) {
            const [appVariable] = ownerEntry;
            const listenCall = listenCalls.get(appVariable);

            if (listenCall && listenCall.arguments.length === 1) {
              const [portExpression] = listenCall.arguments;

              if (nextArgs.length === 1) {
                nextArgs = [nextArgs[0], ts.factory.createObjectLiteralExpression([
                  ts.factory.createPropertyAssignment('port', portExpression),
                ], true)];
                portFoldedApps.add(appVariable);
              } else if (nextArgs.length === 2 && ts.isObjectLiteralExpression(nextArgs[1])) {
                const hasPort = nextArgs[1].properties.some((property) => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'port');

                if (!hasPort) {
                  nextArgs = [
                    nextArgs[0],
                    ts.factory.updateObjectLiteralExpression(nextArgs[1], [
                      ...nextArgs[1].properties,
                      ts.factory.createPropertyAssignment('port', portExpression),
                    ]),
                  ];
                  portFoldedApps.add(appVariable);
                }
              }

              if (!portFoldedApps.has(appVariable)) {
                warnings.push(
                  buildWarning(filePath, sourceFile, node, 'Unable to move listen() port argument into KonektiFactory.create options. Review bootstrap manually.'),
                );
              }
            }
          }

          rewrittenCreateCallKeys.add(toCallKey(node));

          return ts.factory.updateCallExpression(
            node,
            ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('KonektiFactory'), ts.factory.createIdentifier('create')),
            undefined,
            nextArgs,
          );
        }

        if (ts.isIdentifier(node.expression.expression) && node.expression.name.text === 'listen') {
          const appVariable = node.expression.expression.text;
          if (createCalls.has(appVariable) && node.arguments.length > 0 && portFoldedApps.has(appVariable)) {
            return ts.factory.updateCallExpression(node, node.expression, node.typeArguments, []);
          }
        }
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (node: T) => ts.visitNode(node, visit);
  };

  const transformed = ts.transform(sourceFile, [transformer]).transformed[0] as ts.SourceFile;

  if (rewrittenCreateCallKeys.size === 0) {
    return {
      changed: false,
      source,
      warnings,
    };
  }

  let nextSource = printer.printFile(transformed);

  const removed = removeImportBinding(nextSource, filePath, '@nestjs/core', 'NestFactory');
  nextSource = removed.source;

  const nextSourceFile = parseSource(nextSource, filePath);
  const withRuntimeImport = printSourceFile(nextSourceFile, mergeNamedImport([...nextSourceFile.statements], '@konekti/runtime', [{ imported: 'KonektiFactory', local: 'KonektiFactory' }]));

  return {
    changed: withRuntimeImport !== source,
    source: withRuntimeImport,
    warnings,
  };
}

function rewriteTesting(source: string, filePath: string): { changed: boolean; source: string; warnings: MigrationWarning[] } {
  const sourceFile = parseSource(source, filePath);
  const warnings: MigrationWarning[] = [];
  let convertedCalls = 0;
  const supportedBuilderMethods = new Set([
    'compile',
    'overrideProvider',
    'overrideProviders',
    'overrideGuard',
    'overrideInterceptor',
    'overrideFilter',
    'overrideModule',
  ]);

  const convertTestingMetadata = (
    callExpression: ts.CallExpression,
  ): { convertedArgument: ts.ObjectLiteralExpression } | { warning: string } => {
    if (callExpression.arguments.length !== 1) {
      return {
        warning: 'Unsupported Test.createTestingModule call shape. Expected exactly one metadata object argument.',
      };
    }

    const [metadataArgument] = callExpression.arguments;
    if (!metadataArgument || !ts.isObjectLiteralExpression(metadataArgument)) {
      return {
        warning: 'Unsupported Test.createTestingModule metadata shape. Expected an object literal.',
      };
    }

    const properties = metadataArgument.properties;
    const propertyAssignments = properties.filter(ts.isPropertyAssignment);
    const unsupportedPropertyKinds = properties.some((property) => !ts.isPropertyAssignment(property));
    if (unsupportedPropertyKinds) {
      return {
        warning: 'Unsupported Test.createTestingModule metadata shape. Manual migration required.',
      };
    }

    const getProperty = (name: string): ts.PropertyAssignment | undefined => {
      for (const property of propertyAssignments) {
        if (ts.isIdentifier(property.name) && property.name.text === name) {
          return property;
        }
      }

      return undefined;
    };

    const rootModuleProperty = getProperty('rootModule');
    if (rootModuleProperty) {
      if (propertyAssignments.length !== 1) {
        return {
          warning: 'Unsupported Test.createTestingModule metadata shape. Keep only rootModule for automatic rewrite.',
        };
      }

      return {
        convertedArgument: ts.factory.createObjectLiteralExpression(
          [ts.factory.createPropertyAssignment('rootModule', rootModuleProperty.initializer)],
          true,
        ),
      };
    }

    const importsProperty = getProperty('imports');
    if (!importsProperty || propertyAssignments.length !== 1 || !ts.isArrayLiteralExpression(importsProperty.initializer) || importsProperty.initializer.elements.length !== 1) {
      return {
        warning: 'Unsupported Test.createTestingModule metadata shape. Expected { imports: [RootModule] } or { rootModule: RootModule }.',
      };
    }

    const [rootModuleExpression] = importsProperty.initializer.elements;
    return {
      convertedArgument: ts.factory.createObjectLiteralExpression(
        [ts.factory.createPropertyAssignment('rootModule', rootModuleExpression)],
        true,
      ),
    };
  };

  const hasNestTestCreateCall = (file: ts.SourceFile): boolean => {
    let found = false;

    const inspect = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Test'
        && node.expression.name.text === 'createTestingModule'
      ) {
        found = true;
      }

      if (!found) {
        ts.forEachChild(node, inspect);
      }
    };

    inspect(file);
    return found;
  };

  const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
    const visit = (node: ts.Node): ts.Node => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Test'
        && node.expression.name.text === 'createTestingModule'
      ) {
        let cursor: ts.Node = node;
        while (true) {
          if (
            ts.isPropertyAccessExpression(cursor.parent)
            && cursor.parent.expression === cursor
            && ts.isCallExpression(cursor.parent.parent)
            && cursor.parent.parent.expression === cursor.parent
          ) {
            const methodName = cursor.parent.name.text;
            if (!supportedBuilderMethods.has(methodName)) {
              warnings.push(
                buildWarning(
                  filePath,
                  sourceFile,
                  cursor.parent,
                  `Unsupported testing builder method "${methodName}" after Test.createTestingModule. Keep Nest testing chain and migrate manually.`,
                ),
              );
              return node;
            }

            cursor = cursor.parent.parent;
            continue;
          }

          break;
        }

        const conversion = convertTestingMetadata(node);
        if ('warning' in conversion) {
          warnings.push(buildWarning(filePath, sourceFile, node, `${conversion.warning} Keep Nest testing metadata and migrate this test manually.`));
          return node;
        }

        convertedCalls += 1;
        return ts.factory.updateCallExpression(
          node,
          ts.factory.createIdentifier('createTestingModule'),
          node.typeArguments,
          [conversion.convertedArgument],
        );
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (node: T) => ts.visitNode(node, visit);
  };

  const transformed = ts.transform(sourceFile, [transformer]).transformed[0] as ts.SourceFile;
  if (convertedCalls === 0) {
    return {
      changed: false,
      source,
      warnings,
    };
  }

  let nextSource = printer.printFile(transformed);

  const nextSourceFile = parseSource(nextSource, filePath);
  nextSource = printSourceFile(
    nextSourceFile,
    mergeNamedImport([...nextSourceFile.statements], '@konekti/testing', [{ imported: 'createTestingModule', local: 'createTestingModule' }]),
  );

  const withKonektiImportSourceFile = parseSource(nextSource, filePath);
  if (!hasNestTestCreateCall(withKonektiImportSourceFile)) {
    const removedTest = removeImportBinding(nextSource, filePath, '@nestjs/testing', 'Test');
    nextSource = removedTest.source;
  }

  return {
    changed: nextSource !== source,
    source: nextSource,
    warnings,
  };
}

function rewriteTsconfig(source: string, filePath: string): { changed: boolean; source: string; warnings: MigrationWarning[] } {
  try {
    const parsed = JSON.parse(source) as { compilerOptions?: Record<string, unknown> };

    if (!parsed.compilerOptions) {
      return { changed: false, source, warnings: [] };
    }

    const nextCompilerOptions = { ...parsed.compilerOptions };
    const hadExperimentalDecorators = 'experimentalDecorators' in nextCompilerOptions;
    const hadDecoratorMetadata = 'emitDecoratorMetadata' in nextCompilerOptions;

    delete nextCompilerOptions.experimentalDecorators;
    delete nextCompilerOptions.emitDecoratorMetadata;

    if (!hadExperimentalDecorators && !hadDecoratorMetadata) {
      return { changed: false, source, warnings: [] };
    }

    return {
      changed: true,
      source: `${JSON.stringify({ ...parsed, compilerOptions: nextCompilerOptions }, null, 2)}\n`,
      warnings: [],
    };
  } catch {
    return {
      changed: false,
      source,
      warnings: [{ filePath, line: 1, message: 'Failed to parse tsconfig.json. Rewrite it manually.' }],
    };
  }
}

function detectManualFollowUps(source: string, filePath: string): MigrationWarning[] {
  const sourceFile = parseSource(source, filePath);
  const warnings: MigrationWarning[] = [];
  let hasRequestDecoratorWarning = false;
  let hasInjectParameterWarning = false;
  let hasPipesWarning = false;

  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.modifiers) {
      for (const modifier of node.modifiers) {
        if (!ts.isDecorator(modifier) || !ts.isCallExpression(modifier.expression) || !ts.isIdentifier(modifier.expression.expression)) {
          continue;
        }

        const decoratorName = modifier.expression.expression.text;
        if (!hasInjectParameterWarning && decoratorName === 'Inject') {
          hasInjectParameterWarning = true;
          warnings.push(
            buildWarning(filePath, sourceFile, modifier, 'Constructor @Inject(TOKEN) parameter decorators need manual migration to class-level @Inject([...]).'),
          );
        }

        if (!hasRequestDecoratorWarning && REQUEST_DTO_DECORATORS.has(decoratorName)) {
          hasRequestDecoratorWarning = true;
          warnings.push(
            buildWarning(filePath, sourceFile, modifier, 'Handler parameter decorators should be reviewed for RequestDto + DTO field decorator migration.'),
          );
        }

        if (!hasPipesWarning && decoratorName === 'UsePipes') {
          hasPipesWarning = true;
          warnings.push(
            buildWarning(filePath, sourceFile, modifier, 'Detected @UsePipes usage. Migrate transform/pipe logic to converters + RequestDto validation.'),
          );
        }
      }
    }

    if (!hasPipesWarning && ts.isIdentifier(node) && /(?:ValidationPipe|Parse\w*Pipe)$/.test(node.text)) {
      hasPipesWarning = true;
      warnings.push(
        buildWarning(filePath, sourceFile, node, 'Detected Nest pipe usage. Review converter migration manually.'),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return warnings;
}

function gatherTargetFiles(targetPath: string, includeTsconfig: boolean): string[] {
  const resolvedPath = resolve(targetPath);
  const stats = statSync(resolvedPath);

  if (stats.isFile()) {
    const extension = extname(resolvedPath);
    if (extension === '.ts' || extension === '.tsx') {
      return [resolvedPath];
    }

    if (includeTsconfig && basename(resolvedPath) === 'tsconfig.json') {
      return [resolvedPath];
    }

    return [];
  }

  const collected: string[] = [];
  const queue = [resolvedPath];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }

      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        collected.push(absolutePath);
        continue;
      }

      if (includeTsconfig && entry.isFile() && entry.name === 'tsconfig.json') {
        collected.push(absolutePath);
      }
    }
  }

  return collected.sort((left, right) => left.localeCompare(right));
}

function runTypeScriptTransforms(
  source: string,
  filePath: string,
  enabledTransforms: ReadonlySet<MigrationTransformKind>,
): { appliedTransforms: MigrationTransformKind[]; source: string; warnings: MigrationWarning[] } {
  let nextSource = source;
  const appliedTransforms: MigrationTransformKind[] = [];
  const warnings: MigrationWarning[] = [];

  if (enabledTransforms.has('imports')) {
    const rewritten = rewriteImports(nextSource, filePath);
    nextSource = rewritten.source;
    warnings.push(...rewritten.warnings);

    if (rewritten.changed) {
      appliedTransforms.push('imports');
    }
  }

  if (enabledTransforms.has('injectable') || enabledTransforms.has('scope')) {
    const rewritten = rewriteInjectableAndScope(nextSource, filePath, {
      removeInjectable: enabledTransforms.has('injectable'),
      rewriteScope: enabledTransforms.has('scope'),
    });
    nextSource = rewritten.source;
    warnings.push(...rewritten.warnings);

    if (rewritten.changed) {
      if (enabledTransforms.has('injectable')) {
        appliedTransforms.push('injectable');
      }

      if (enabledTransforms.has('scope')) {
        appliedTransforms.push('scope');
      }
    }
  }

  if (enabledTransforms.has('bootstrap')) {
    const rewritten = rewriteBootstrap(nextSource, filePath);
    nextSource = rewritten.source;
    warnings.push(...rewritten.warnings);

    if (rewritten.changed) {
      appliedTransforms.push('bootstrap');
    }
  }

  if (enabledTransforms.has('testing')) {
    const rewritten = rewriteTesting(nextSource, filePath);
    nextSource = rewritten.source;
    warnings.push(...rewritten.warnings);

    if (rewritten.changed) {
      appliedTransforms.push('testing');
    }
  }

  warnings.push(...detectManualFollowUps(source, filePath));

  return {
    appliedTransforms: [...new Set(appliedTransforms)],
    source: nextSource,
    warnings,
  };
}

export function runNestJsMigration(options: RunNestJsMigrationOptions): MigrationReport {
  const resolvedTargetPath = resolve(options.targetPath);
  if (!existsSync(resolvedTargetPath)) {
    throw new Error(`Migration target does not exist: ${resolvedTargetPath}`);
  }

  const includeTsconfig = options.enabledTransforms.has('tsconfig');
  const files = gatherTargetFiles(resolvedTargetPath, includeTsconfig);
  const fileResults: FileMigrationResult[] = [];

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8');
    const isTsconfig = basename(filePath) === 'tsconfig.json';

    if (isTsconfig) {
      const rewritten = rewriteTsconfig(source, filePath);
      const changed = rewritten.changed;

      if (changed && options.apply) {
        writeFileSync(filePath, rewritten.source, 'utf8');
      }

      fileResults.push({
        appliedTransforms: changed ? ['tsconfig'] : [],
        changed,
        filePath,
        warnings: rewritten.warnings,
      });
      continue;
    }

    const rewritten = runTypeScriptTransforms(source, filePath, options.enabledTransforms);
    const changed = rewritten.source !== source;

    if (changed && options.apply) {
      writeFileSync(filePath, rewritten.source, 'utf8');
    }

    fileResults.push({
      appliedTransforms: rewritten.appliedTransforms,
      changed,
      filePath,
      warnings: rewritten.warnings,
    });
  }

  return {
    apply: options.apply,
    changedFiles: fileResults.filter((result) => result.changed).length,
    scannedFiles: files.length,
    warningCount: fileResults.reduce((total, result) => total + result.warnings.length, 0),
    fileResults,
  };
}

export function renderTransformList(kinds: readonly MigrationTransformKind[]): string {
  return kinds.map((kind) => `${kind} (${TRANSFORM_KIND_LABEL[kind]})`).join(', ');
}
