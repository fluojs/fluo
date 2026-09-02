import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulePath = 'packages/graphql/src/module.ts';
const typesPath = 'packages/graphql/src/types.ts';
const documentationPaths = [
  'packages/graphql/README.md',
  'packages/graphql/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'book/intermediate/ch18-graphql.md',
  'book/intermediate/ch18-graphql.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
];
const documentationMarkers = [
  'GraphqlModule.forRootAsync',
  'inject',
  'useFactory',
  'imports',
  'useClass',
  'useExisting',
];

function fail(relativePath, message) {
  throw new Error(`GraphQL async registration contract check failed: ${relativePath} ${message}.`);
}

function assert(condition, relativePath, message) {
  if (!condition) {
    fail(relativePath, message);
  }
}

function parseSource(relativePath, sourceText) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert(
    source.parseDiagnostics.length === 0,
    relativePath,
    'must remain valid TypeScript',
  );
  return source;
}

function propertyName(node) {
  if (node === undefined) {
    return undefined;
  }

  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    ? node.text
    : node.getText();
}

function propertyInitializer(object, name) {
  const property = object.properties.find((candidate) =>
    (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate))
    && propertyName(candidate.name) === name);

  if (property === undefined) {
    return undefined;
  }

  return ts.isPropertyAssignment(property) ? property.initializer : property.name;
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

export function enforceGraphqlAsyncRegistrationContract(readText = read) {
  const moduleSource = parseSource(modulePath, readText(modulePath));
  const typesSource = parseSource(typesPath, readText(typesPath));
  const graphqlModule = moduleSource.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'GraphqlModule');
  const forRootAsync = graphqlModule?.members.find((member) =>
    ts.isMethodDeclaration(member) && propertyName(member.name) === 'forRootAsync');
  const optionsValidator = moduleSource.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'assertGraphqlAsyncModuleOptions');
  const asyncOptions = typesSource.statements.find((statement) =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === 'GraphqlAsyncModuleOptions');

  assert(graphqlModule, modulePath, 'must declare GraphqlModule');
  assert(forRootAsync && ts.isMethodDeclaration(forRootAsync), modulePath, 'must declare GraphqlModule.forRootAsync(...)');
  assert(asyncOptions && ts.isInterfaceDeclaration(asyncOptions), typesPath, 'must declare GraphqlAsyncModuleOptions');
  assert(
    asyncOptions.heritageClauses?.[0]?.types[0]?.getText() ===
      "Pick<AsyncModuleOptions<GraphqlModuleOptions>, 'inject' | 'useFactory'>",
    typesPath,
    'must expose exactly the inject and useFactory async options',
  );
  assert(
    forRootAsync.parameters[0]?.name.getText() === 'options'
      && forRootAsync.parameters[0]?.type?.getText() === 'GraphqlAsyncModuleOptions',
    modulePath,
    'must accept typed GraphqlAsyncModuleOptions',
  );
  assert(
    optionsValidator && ts.isFunctionDeclaration(optionsValidator)
      && optionsValidator.getText().includes('Object.keys(options).find')
      && optionsValidator.getText().includes("typeof options.useFactory !== 'function'")
      && optionsValidator.getText().includes('options.inject !== undefined && !Array.isArray(options.inject)'),
    modulePath,
    'must reject unsupported fields and malformed useFactory or inject options',
  );

  const returnStatement = forRootAsync.body?.statements.find(ts.isReturnStatement);
  const defineModuleCall = returnStatement?.expression;
  assert(
    defineModuleCall && ts.isCallExpression(defineModuleCall)
      && defineModuleCall.expression.getText() === 'defineModule'
      && ts.isObjectLiteralExpression(defineModuleCall.arguments[1]),
    modulePath,
    'must return defineModule(...) metadata',
  );

  const metadata = defineModuleCall.arguments[1];
  const providers = propertyInitializer(metadata, 'providers');
  assert(
    providers && ts.isCallExpression(providers)
      && providers.expression.getText() === 'createGraphqlProviders'
      && ts.isObjectLiteralExpression(providers.arguments[0]),
    modulePath,
    'must register the internal options provider through createGraphqlProviders(...)',
  );

  const optionsProvider = providers.arguments[0];
  const providerNames = optionsProvider.properties.map((property) => propertyName(property.name)).sort();
  assert(
    providerNames.join(',') === 'inject,provide,scope,useFactory',
    modulePath,
    `must use exactly the inject, provide, scope, and useFactory options provider fields; found ${providerNames.join(', ')}`,
  );
  assert(
    propertyInitializer(optionsProvider, 'inject')?.getText() === '[RUNTIME_CONTAINER]'
      && propertyInitializer(optionsProvider, 'provide')?.getText() === 'GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN'
      && propertyInitializer(optionsProvider, 'scope')?.getText() === "'singleton'",
    modulePath,
    'must resolve explicit inject tokens through the singleton runtime-container options provider',
  );

  const factory = propertyInitializer(optionsProvider, 'useFactory');
  assert(
    factory && ts.isArrowFunction(factory)
      && factory.getText().includes('resolveAsyncDependency(runtimeContainer, token)')
      && factory.getText().includes('Reflect.apply(options.useFactory, options, injectedDependencies)'),
    modulePath,
    'must resolve explicit tokens and invoke useFactory with their values',
  );

  for (const documentationPath of documentationPaths) {
    const documentation = readText(documentationPath);
    const missingMarkers = documentationMarkers.filter((marker) => !documentation.includes(marker));
    assert(
      missingMarkers.length === 0,
      documentationPath,
      `must document the source-backed async registration boundary; missing ${missingMarkers.join(', ')}`,
    );
  }
}
