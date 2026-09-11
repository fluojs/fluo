import ts from 'typescript';

const metricsRootExportTargets = [
  './metrics-module.js',
  './metrics-service.js',
];
const metricsIntegrationWildcardTargets = [
  './http-metrics-middleware.js',
  './providers/meter-provider.js',
  './providers/prometheus-meter-provider.js',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Metrics registry integration boundary violation: ${message}`);
  }
}

function sourceFile(path, sourceText) {
  return ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function exportDeclarations(path, sourceText) {
  return sourceFile(path, sourceText).statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement)
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [];
    }

    return [{
      exportClause: statement.exportClause,
      target: statement.moduleSpecifier.text,
    }];
  });
}

function hasExactTargets(declarations, expectedTargets) {
  const actualTargets = declarations.map(({ target }) => target).sort();
  const expected = [...expectedTargets].sort();
  return actualTargets.length === expected.length &&
    actualTargets.every((target, index) => target === expected[index]);
}

function findInterface(source, name) {
  return source.statements.find((statement) =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === name);
}

function hasIdentifier(node, expectedName) {
  let found = false;
  const visit = (candidate) => {
    if (ts.isIdentifier(candidate) && candidate.text === expectedName) {
      found = true;
      return;
    }

    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function findStaticMethod(source, className, methodName) {
  const declaration = source.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  if (!declaration) {
    return undefined;
  }

  return declaration.members.find((member) =>
    ts.isMethodDeclaration(member)
    && member.name
    && ts.isIdentifier(member.name)
    && member.name.text === methodName &&
      member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword));
}

function hasBootstrapRegistryProvider(forRoot) {
  let registryProvider;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'registryProvider' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      registryProvider = node.initializer;
    }

    ts.forEachChild(node, visit);
  };
  visit(forRoot);

  if (!registryProvider) {
    return false;
  }

  const property = (name) => registryProvider.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === name)?.initializer;
  const inject = property('inject');
  const useFactory = property('useFactory');

  return Boolean(inject && useFactory && hasIdentifier(inject, 'BOOTSTRAP_PROVIDER_TOKENS') &&
    hasIdentifier(useFactory, 'METRICS_REGISTRY'));
}

/**
 * Rejects source and manifest drift across the published Metrics root and integration APIs.
 *
 * @param files Current source and manifest text for the machine-consumed metrics boundary.
 */
export function enforceMetricsRegistryIntegrationBoundary(files) {
  const rootExports = exportDeclarations('packages/metrics/src/index.ts', files.root);
  assert(
    rootExports.every(({ exportClause }) => exportClause === undefined) &&
      hasExactTargets(rootExports, metricsRootExportTargets),
    'the root entrypoint must export only MetricsModule and MetricsService source modules.',
  );

  const integrationExports = exportDeclarations('packages/metrics/src/integration.ts', files.integration);
  const registryExport = integrationExports.find(({ target }) => target === 'prom-client');
  assert(
    registryExport?.exportClause &&
      ts.isNamedExports(registryExport.exportClause) &&
      registryExport.exportClause.elements.length === 1 &&
      registryExport.exportClause.elements[0]?.name.text === 'Registry',
    'the integration entrypoint must export the prom-client Registry constructor.',
  );
  const integrationWildcards = integrationExports.filter(({ target }) =>
    target !== 'prom-client' && target !== undefined);
  assert(
    integrationWildcards.every(({ exportClause }) => exportClause === undefined) &&
      hasExactTargets(integrationWildcards, metricsIntegrationWildcardTargets),
    'the integration entrypoint must own the direct middleware and meter-provider exports.',
  );

  const metricsModuleSource = sourceFile('packages/metrics/src/metrics-module.ts', files.module);
  const options = findInterface(metricsModuleSource, 'MetricsModuleOptions');
  assert(options, 'MetricsModuleOptions must remain a declared public options interface.');
  const optionNames = options.members
    .filter(ts.isPropertySignature)
    .map((member) => member.name && ts.isIdentifier(member.name) ? member.name.text : undefined);
  assert(
    !optionNames.includes('registry'),
    'MetricsModuleOptions must not restore the removed registry module option.',
  );
  const forRoot = findStaticMethod(metricsModuleSource, 'MetricsModule', 'forRoot');
  assert(forRoot, 'MetricsModule must retain the static forRoot registration path.');
  assert(
    hasBootstrapRegistryProvider(forRoot),
    'MetricsModule.forRoot must resolve METRICS_REGISTRY through its registry provider bootstrap path.',
  );

  const manifest = JSON.parse(files.manifest);
  assert(
    manifest.exports?.['.']?.import === './dist/index.js' &&
      manifest.exports?.['.']?.types === './dist/index.d.ts' &&
      manifest.exports?.['./integration']?.import === './dist/integration.js' &&
      manifest.exports?.['./integration']?.types === './dist/integration.d.ts',
    'package exports must publish both the root and integration entrypoints with JavaScript and declaration artifacts.',
  );
}
