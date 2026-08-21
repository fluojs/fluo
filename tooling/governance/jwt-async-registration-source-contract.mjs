import ts from 'typescript';

import { collectDeclarations, validateJwtAsyncOptions } from './jwt-async-registration-type-surface.mjs';

const coreTypesPath = 'packages/core/src/types.ts';
const configModulePath = 'packages/config/src/module.ts';
const jwtModulePath = 'packages/jwt/src/module.ts';

function fail(relativePath, message) {
  throw new Error(`JWT async registration contract check failed: ${relativePath} ${message}.`);
}

function assert(condition, relativePath, message) {
  if (!condition) {
    fail(relativePath, message);
  }
}

function parseSource(relativePath, sourceText) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ');
    fail(relativePath, `must remain valid TypeScript (${details})`);
  }
  return source;
}

function propertyName(node) {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return node.getText();
}

function propertyInitializer(object, name) {
  const property = object.properties.find((candidate) =>
    (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate))
    && propertyName(candidate.name) === name);
  if (property && ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  return property && ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
}

function moduleMetadataInitializer(body, targetName) {
  const statement = body?.statements.find((candidate) =>
    ts.isExpressionStatement(candidate)
    && ts.isCallExpression(candidate.expression)
    && candidate.expression.expression.getText() === 'defineModuleMetadata'
    && ts.isIdentifier(candidate.expression.arguments[0])
    && candidate.expression.arguments[0].text === targetName);

  return statement && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
    ? statement.expression.arguments[1]
    : undefined;
}

export function enforceJwtAsyncRegistrationSourceContract(readText) {
  const coreTypes = parseSource(coreTypesPath, readText(coreTypesPath));
  const configModuleSource = parseSource(configModulePath, readText(configModulePath));
  const jwtModuleSource = parseSource(jwtModulePath, readText(jwtModulePath));
  const declarations = collectDeclarations([coreTypes, jwtModuleSource]);
  const asyncOptions = declarations.get('AsyncModuleOptions')?.find(ts.isInterfaceDeclaration);
  assert(asyncOptions, coreTypesPath, 'must declare AsyncModuleOptions<T>');
  const useFactoryMember = asyncOptions.members.find((member) => propertyName(member.name) === 'useFactory');
  assert(
    useFactoryMember?.type?.getText().includes('MaybePromise<T>'),
    coreTypesPath,
    'must keep useFactory responsible for returning the final typed module options',
  );

  const configModule = configModuleSource.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'ConfigModule');
  const configForRoot = configModule?.members.find((member) =>
    ts.isMethodDeclaration(member) && propertyName(member.name) === 'forRoot');
  const configMetadata = moduleMetadataInitializer(configForRoot?.body, 'ConfigModuleImpl');
  const configExports = configMetadata && ts.isObjectLiteralExpression(configMetadata)
    ? propertyInitializer(configMetadata, 'exports')
    : undefined;
  assert(
    configMetadata && ts.isObjectLiteralExpression(configMetadata)
      && propertyInitializer(configMetadata, 'global')?.getText() === 'loadOptions.global ?? true'
      && configExports && ts.isArrayLiteralExpression(configExports)
      && configExports.elements.some((element) => ts.isIdentifier(element) && element.text === 'ConfigService'),
    configModulePath,
    'must export ConfigService globally by default for async module factories',
  );

  const jwtModule = jwtModuleSource.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'JwtModule');
  const forRootAsync = jwtModule?.members.find((member) =>
    ts.isMethodDeclaration(member) && propertyName(member.name) === 'forRootAsync');
  assert(forRootAsync && ts.isMethodDeclaration(forRootAsync), jwtModulePath, 'must declare JwtModule.forRootAsync(...)');
  const optionsType = forRootAsync.parameters[0]?.type;
  assert(optionsType, jwtModulePath, 'must type JwtModule.forRootAsync(...) options');
  validateJwtAsyncOptions(optionsType, declarations, assert, jwtModulePath);

  const returnStatement = forRootAsync.body?.statements.find(ts.isReturnStatement);
  const createModuleCall = returnStatement?.expression && ts.isCallExpression(returnStatement.expression)
    ? returnStatement.expression
    : undefined;
  const optionsProvider = createModuleCall?.arguments[0];
  assert(
    createModuleCall?.expression.getText() === 'this.createModule' &&
      optionsProvider !== undefined && ts.isObjectLiteralExpression(optionsProvider),
    jwtModulePath,
    'must pass one explicit options provider into createModule(...)',
  );
  const providerNames = optionsProvider.properties.map((property) => propertyName(property.name)).sort();
  assert(
    providerNames.join(',') === 'inject,provide,scope,useFactory',
    jwtModulePath,
    `options provider must contain exactly inject, provide, scope, and useFactory; found ${providerNames.join(', ')}`,
  );
  assert(
    propertyInitializer(optionsProvider, 'inject')?.getText() === 'options.inject' &&
      propertyInitializer(optionsProvider, 'useFactory')?.getText() === 'options.useFactory',
    jwtModulePath,
    'must forward inject and useFactory to the JWT options provider',
  );
  assert(
    createModuleCall.arguments[5]?.getText() === 'options.global ?? false',
    jwtModulePath,
    'must forward top-level global to module visibility',
  );

  const createModule = jwtModule?.members.find((member) =>
    ts.isMethodDeclaration(member) && propertyName(member.name) === 'createModule');
  const jwtRuntimeMetadata = moduleMetadataInitializer(createModule?.body, 'JwtRuntimeModule');
  assert(
    jwtRuntimeMetadata && ts.isObjectLiteralExpression(jwtRuntimeMetadata)
      && propertyInitializer(jwtRuntimeMetadata, 'global')?.getText() === 'global',
    jwtModulePath,
    'must propagate the createModule global parameter to JwtRuntimeModule metadata',
  );
}
