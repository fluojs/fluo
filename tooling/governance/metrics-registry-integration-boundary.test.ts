import { readFileSync } from 'node:fs';

import {
  createSourceFile,
  isCallExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  enforceMetricsRegistryIntegrationBoundary,
} from './metrics-registry-integration-boundary.mjs';

const boundaryFiles = {
  integration: readFileSync(new URL('../../packages/metrics/src/integration.ts', import.meta.url), 'utf8'),
  manifest: readFileSync(new URL('../../packages/metrics/package.json', import.meta.url), 'utf8'),
  module: readFileSync(new URL('../../packages/metrics/src/metrics-module.ts', import.meta.url), 'utf8'),
  root: readFileSync(new URL('../../packages/metrics/src/index.ts', import.meta.url), 'utf8'),
};

function expectBoundaryFailure(run: () => void): void {
  expect(run).toThrow(/Metrics registry integration boundary/u);
}

function hasGuardRegistration(sourceText: string): boolean {
  const source = createSourceFile(
    'verify-platform-consistency-governance.mjs',
    sourceText,
    ScriptTarget.Latest,
    true,
    ScriptKind.JS,
  );
  const hasImport = source.statements.some((statement) =>
    isImportDeclaration(statement)
    && isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === './metrics-registry-integration-boundary.mjs'
    && statement.importClause?.namedBindings
    && isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(
      (element) => element.name.text === 'enforceMetricsRegistryIntegrationBoundary',
    ),
  );
  const hasMainCall = source.statements.some((statement) =>
    isFunctionDeclaration(statement)
    && statement.name?.text === 'main'
    && statement.body?.statements.some((bodyStatement) =>
      isExpressionStatement(bodyStatement)
      && isCallExpression(bodyStatement.expression)
      && isIdentifier(bodyStatement.expression.expression)
      && bodyStatement.expression.expression.text === 'enforceMetricsRegistryIntegrationBoundary',
    ),
  );

  return hasImport && hasMainCall;
}

describe('Metrics registry integration boundary', () => {
  it('accepts the published root, integration, bootstrap, and manifest boundaries', () => {
    // Given the current published metrics artifacts.
    // When the governance guard evaluates the public boundary.
    // Then the canonical root and integration subpath remain coherent.
    expect(() => enforceMetricsRegistryIntegrationBoundary(boundaryFiles)).not.toThrow();
  });

  it.each([
    [
      'a low-level meter provider re-exported from the root entrypoint',
      { ...boundaryFiles, root: `${boundaryFiles.root}export * from './providers/meter-provider.js';\n` },
    ],
    [
      'the Registry constructor removed from the integration entrypoint',
      { ...boundaryFiles, integration: boundaryFiles.integration.replace("export { Registry } from 'prom-client';\n", '') },
    ],
    [
      'the removed module registry option restored',
      { ...boundaryFiles, module: boundaryFiles.module.replace('  path?: string | false;\n', '  path?: string | false;\n  registry?: Registry;\n') },
    ],
    [
      'the forRoot registry provider no longer resolves the bootstrap METRICS_REGISTRY token',
      {
        ...boundaryFiles,
        module: boundaryFiles.module.replace(
          `const configuredRegistry = assertBootstrapProviderTokens(bootstrapProviderTokens).has(METRICS_REGISTRY)
          ? assertPrometheusRegistry(await runtimeContainer.resolve(METRICS_REGISTRY))
          : undefined;`,
          'const configuredRegistry = undefined;',
        ),
      },
    ],
    [
      'the published integration subpath removed from the manifest',
      {
        ...boundaryFiles,
        manifest: JSON.stringify({
          ...JSON.parse(boundaryFiles.manifest),
          exports: {
            '.': JSON.parse(boundaryFiles.manifest).exports['.'],
          },
        }),
      },
    ],
  ])('rejects %s', (_label, files) => {
    // Given one machine-consumed public artifact regression.
    // When the governance guard evaluates the mutated boundary.
    // Then the artifact regression is rejected.
    expectBoundaryFailure(() => enforceMetricsRegistryIntegrationBoundary(files));
  });

  it.each([
    [
      'root export target comparison',
      'hasExactTargets(rootExports, metricsRootExportTargets)',
      'true',
      { ...boundaryFiles, root: `${boundaryFiles.root}export * from './providers/meter-provider.js';\n` },
    ],
    [
      'removed registry option comparison',
      "!optionNames.includes('registry')",
      'true',
      { ...boundaryFiles, module: boundaryFiles.module.replace('  path?: string | false;\n', '  path?: string | false;\n  registry?: Registry;\n') },
    ],
    [
      'forRoot registry provider ownership comparison',
      `hasBootstrapRegistryProvider(forRoot),
    'MetricsModule.forRoot must resolve METRICS_REGISTRY through its registry provider bootstrap path.',`,
      `true,
    'MetricsModule.forRoot must resolve METRICS_REGISTRY through its registry provider bootstrap path.',`,
      {
        ...boundaryFiles,
        module: boundaryFiles.module.replace(
          `const configuredRegistry = assertBootstrapProviderTokens(bootstrapProviderTokens).has(METRICS_REGISTRY)
          ? assertPrometheusRegistry(await runtimeContainer.resolve(METRICS_REGISTRY))
          : undefined;`,
          'const configuredRegistry = undefined;',
        ),
      },
    ],
    [
      'integration export target comparison',
      'hasExactTargets(integrationWildcards, metricsIntegrationWildcardTargets)',
      'true',
      { ...boundaryFiles, integration: boundaryFiles.integration.replace("export * from './providers/meter-provider.js';\n", '') },
    ],
  ])('fails its negative expectation when the %s is removed', async (_label, target, replacement, files) => {
    // Given one guard comparison disabled in the actual enforcement source.
    const sourceUrl = new URL('./metrics-registry-integration-boundary.mjs', import.meta.url);
    const source = readFileSync(sourceUrl, 'utf8');
    expect(source.split(target)).toHaveLength(2);
    const mutated = source.replace(target, replacement)
      .replace("from 'typescript'", `from '${import.meta.resolve('typescript')}'`);
    const governance: Pick<typeof import('./metrics-registry-integration-boundary.mjs'), 'enforceMetricsRegistryIntegrationBoundary'> =
      await import(`data:text/javascript;base64,${Buffer.from(mutated).toString('base64')}`);
    const run = () => governance.enforceMetricsRegistryIntegrationBoundary(files);

    // When a matching artifact regression reaches the mutated guard.
    // Then the normal rejection expectation itself fails, proving this comparison is required.
    expect(run).not.toThrow();
    expect(() => expectBoundaryFailure(run)).toThrowError(expect.objectContaining({ name: 'AssertionError' }));
  });

  it('is imported and directly invoked by the platform governance verifier', () => {
    // Given the canonical platform governance entrypoint.
    // When its imports and main body are parsed.
    // Then the metrics boundary guard cannot be an unregistered helper.
    const verifier = readFileSync(new URL('./verify-platform-consistency-governance.mjs', import.meta.url), 'utf8');
    expect(hasGuardRegistration(verifier)).toBe(true);
  });
});
