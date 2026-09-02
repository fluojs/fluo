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
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
];
const documentationMarkers = [
  'GraphqlModule.forRootAsync',
  'inject',
  'useFactory',
  'imports',
  'useClass',
  'useExisting',
];
const localizedDocumentationMarkers = [
  'GraphqlModule.forRootAsync',
  'inject',
  'useFactory',
];
const localizedAsyncRegistrationSections = [
  {
    contradictoryClaim: 'synchronous-only',
    end: '## Related Packages',
    path: 'packages/graphql/README.md',
    start: '## Public API',
  },
  {
    contradictoryClaim: '동기 전용',
    end: '## 관련 패키지',
    path: 'packages/graphql/README.ko.md',
    start: '## 공개 API',
  },
  {
    contradictoryClaim: 'synchronous-only',
    end: '## Response cookie migration',
    path: 'docs/getting-started/migrate-from-nestjs.md',
    start: '## GraphQL async registration migration',
  },
  {
    contradictoryClaim: '동기 전용',
    end: '## 응답 쿠키 마이그레이션',
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
    start: '## GraphQL 비동기 등록 마이그레이션',
  },
  {
    contradictoryClaim: 'synchronous-only',
    end: '## 18.4',
    path: 'book/intermediate/ch18-graphql.md',
    start: '### Resolving Module Options Asynchronously',
  },
  {
    contradictoryClaim: '동기 전용',
    end: '## 18.4',
    path: 'book/intermediate/ch18-graphql.ko.md',
    start: '### 비동기 Module Option 해석',
  },
  {
    contradictoryClaim: 'synchronous-only',
    end: '## canonical runtime package matrix',
    path: 'docs/reference/package-surface.md',
    start: '## GraphQL async module registration',
  },
  {
    contradictoryClaim: '동기 전용',
    end: '## canonical runtime package matrix',
    path: 'docs/reference/package-surface.ko.md',
    start: '## GraphQL 비동기 module 등록',
  },
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

function readDocumentationSection(documentation, section) {
  const start = documentation.indexOf(section.start);
  const end = documentation.indexOf(section.end, start + section.start.length);
  assert(start !== -1 && end !== -1, section.path, 'must retain its async registration section boundaries');
  return documentation.slice(start, end);
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
    asyncOptions.typeParameters?.[0]?.name.text === 'TDependencies'
      && asyncOptions.typeParameters[0].constraint?.getText() === 'readonly unknown[]',
    typesPath,
    'must type async factory dependencies as a public tuple generic',
  );
  assert(
    forRootAsync.parameters[0]?.name.getText() === 'options'
      && forRootAsync.parameters[0]?.type?.getText() === 'GraphqlAsyncModuleOptions<TDependencies>'
      && forRootAsync.typeParameters?.[0]?.name.text === 'TDependencies',
    modulePath,
    'must preserve the public dependency tuple on GraphqlModule.forRootAsync',
  );
  const asyncOptionMembers = asyncOptions.members.map((member) =>
    ts.isPropertySignature(member) ? [propertyName(member.name), member.type?.getText()] : []);
  const injectOption = asyncOptionMembers.find(([name]) => name === 'inject');
  const factoryOption = asyncOptionMembers.find(([name]) => name === 'useFactory');
  assert(
    injectOption?.[1] ===
      '{ readonly [Index in keyof TDependencies]: InjectionToken<TDependencies[Index]> }'
      && factoryOption?.[1] === '(...dependencies: TDependencies) => MaybePromise<GraphqlModuleOptions>',
    typesPath,
    'must map injected tokens to matching useFactory parameter types',
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

  for (const section of localizedAsyncRegistrationSections) {
    const documentation = readText(section.path);
    const sectionText = readDocumentationSection(documentation, section);
    const missingMarkers = localizedDocumentationMarkers.filter((marker) => !sectionText.includes(marker));
    assert(
      missingMarkers.length === 0,
      section.path,
      `must keep async registration claims section-local; missing ${missingMarkers.join(', ')}`,
    );
    assert(
      !sectionText.includes(section.contradictoryClaim),
      section.path,
      'contains a contradictory async registration claim',
    );
  }
}
