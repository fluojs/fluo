import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { enforceConfigNestjsMigrationDocs } from './config-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const servicePath = 'packages/config/src/service.ts';

type SingleKeyMethod = 'get' | 'getOrThrow';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/**
 * Rewrites the single-key implementation line of `ConfigService.<methodName>` so a fixture can
 * model a widened call shape. Both the anchor match and the resulting edit are asserted so a
 * reformatted service source fails loudly instead of silently producing a vacuous fixture.
 */
function mutateServiceSource(
  methodName: SingleKeyMethod,
  buildReplacement: (implementationLine: string, indent: string) => string,
): string {
  const source = read(servicePath);
  const match = source.match(new RegExp(`^([ \\t]*)${methodName}<.*\\{$`, 'mu'));

  expect(match, `expected a single-key ${methodName} implementation line in ${servicePath}`).not.toBeNull();

  const [implementationLine, indent] = match as RegExpMatchArray;
  const mutated = source.replace(implementationLine, buildReplacement(implementationLine, indent));

  expect(mutated, `expected the ${methodName} fixture to change ${servicePath}`).not.toBe(source);

  return mutated;
}

function readWithMutatedService(mutated: string): (relativePath: string) => string {
  return (relativePath: string): string => (relativePath === servicePath ? mutated : read(relativePath));
}

/**
 * Rewrites the declared return type of `ConfigService.<methodName>` while leaving its single-key
 * parameter list untouched, so return-shape classification can be exercised on its own.
 */
function mutateServiceReturnType(methodName: SingleKeyMethod, returnType: string): string {
  return mutateServiceSource(methodName, (implementationLine) => {
    const rewritten = implementationLine.replace(/\):\s.*\{$/u, `): ${returnType} {`);

    expect(rewritten, `expected to rewrite the ${methodName} return type`).not.toBe(implementationLine);

    return rewritten;
  });
}

/**
 * Appends a declaration-merged `interface ConfigService` that widens `methodName` with a second
 * parameter. The class body is left untouched, so only an effective-signature check can see it.
 */
function appendMergedInterfaceOverload(methodName: SingleKeyMethod): string {
  const source = read(servicePath);
  const mergedInterface = [
    '',
    'export interface ConfigService<T extends Record<string, unknown> = ConfigDictionary> {',
    `  ${methodName}<K extends DotPaths<T>, D>(key: K, defaultValue: D): DotValue<T, K & string> | D;`,
    '}',
    '',
  ].join('\n');

  expect(source, `expected ${servicePath} to declare the ConfigService class`).toContain('class ConfigService');

  return `${source}${mergedInterface}`;
}

const recipePaths = [
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'book/beginner/ch11-config.md',
  'book/beginner/ch11-config.ko.md',
] as const;

type RecipePart = 'registration' | 'wiring' | 'adapter';

function matchingNodes<T extends ts.Node>(source: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  function visit(node: ts.Node): void {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return matches;
}

function isCall(node: ts.Node, receiver: string, method: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && node.expression.expression.text === receiver &&
    node.expression.name.text === method;
}

function recipeFence(markdown: string, chapterAdapter = false): string {
  const candidates = [...markdown.matchAll(/^```(?:ts|typescript)\r?\n([\s\S]*?)^```\s*$/gmu)]
    .map((match) => match[1] ?? '')
    .filter((text) => {
      const source = ts.createSourceFile('recipe.ts', text, ts.ScriptTarget.Latest, true);
      return chapterAdapter
        ? source.statements.some((node) => ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === './app.module')
        : matchingNodes(source, (node): node is ts.CallExpression => isCall(node, 'ConfigModule', 'load')).length > 0 &&
          matchingNodes(source, (node): node is ts.CallExpression => isCall(node, 'ConfigModule', 'forRoot')).length > 0;
    });
  expect(candidates).toHaveLength(1);
  return candidates[0] as string;
}

function replaceOnce(source: string, before: string, after: string): string {
  expect(source.split(before)).toHaveLength(2);
  const result = source.replace(before, () => after);
  expect(result).not.toBe(source);
  return result;
}

function mutateRecipe(relativePath: string, part: RecipePart, replacement: (text: string) => string): string {
  const markdown = read(relativePath);
  const chapter = relativePath.startsWith('book/');
  const fence = recipeFence(markdown, chapter && part === 'adapter');
  const source = ts.createSourceFile('recipe.ts', fence, ts.ScriptTarget.Latest, true);
  let targets: ts.Node[];
  if (part === 'registration') {
    const declarations = matchingNodes(source, (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.name.text === (chapter ? 'configRegistration' : 'moduleOptions'));
    expect(declarations).toHaveLength(1);
    targets = matchingNodes(declarations[0] as ts.VariableDeclaration, ts.isObjectLiteralExpression);
  } else if (part === 'wiring') {
    targets = matchingNodes(source, (node): node is ts.CallExpression => isCall(node, 'ConfigModule', 'forRoot'))
      .flatMap((call) => [...call.arguments]);
  } else {
    const calls = matchingNodes(source, (node): node is ts.CallExpression => isCall(node, 'FastifyHttpApplicationAdapter', 'create'));
    expect(calls).toHaveLength(1);
    targets = matchingNodes(calls[0] as ts.CallExpression, (node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'port')
      .map((property) => property.initializer);
  }
  expect(targets).toHaveLength(1);
  const target = targets[0] as ts.Node;
  const before = target.getText(source);
  const after = replacement(before);
  expect(after).not.toBe(before);
  const mutatedFence = fence.slice(0, target.getStart(source)) + after + fence.slice(target.end);
  return replaceOnce(markdown, fence, mutatedFence);
}

// This table is deliberately independent of the guard's comparisons: deleting a comparison must
// make the corresponding isolated bad recipe pass the guard and therefore fail its pinned test.
const recipeMutations: readonly [string, RecipePart, (text: string) => string, string][] = [
  ['registration schema', 'registration', (text) => text.replace('{', '{ schema: ConfigSchema,'), 'CONFIG_RECIPE_REVALIDATION'],
  ['missing envFilePaths', 'registration', (text) => replaceOnce(text, 'envFilePaths: [],', ''), 'CONFIG_RECIPE_ENV_FILES'],
  ['nonempty envFilePaths', 'registration', (text) => replaceOnce(text, 'envFilePaths: []', "envFilePaths: ['.env']"), 'CONFIG_RECIPE_ENV_FILES'],
  ['nonarray envFilePaths', 'registration', (text) => replaceOnce(text, 'envFilePaths: []', 'envFilePaths: undefined'), 'CONFIG_RECIPE_ENV_FILES'],
  ['wrong runtimeOverrides', 'registration', (text) => replaceOnce(text, 'runtimeOverrides: validatedConfig', 'runtimeOverrides: configSources'), 'CONFIG_RECIPE_SNAPSHOT_SOURCE'],
  ['missing runtimeOverrides', 'registration', (text) => replaceOnce(text, 'runtimeOverrides: validatedConfig,', ''), 'CONFIG_RECIPE_SNAPSHOT_SOURCE'],
  ['defaults downgrade with comment decoy', 'registration', (text) => replaceOnce(text, 'runtimeOverrides: validatedConfig', 'defaults: validatedConfig /* runtimeOverrides: validatedConfig */'), 'CONFIG_RECIPE_SNAPSHOT_SOURCE'],
  ['extra defaults', 'registration', (text) => text.replace('{', '{ defaults: {},'), 'CONFIG_RECIPE_SNAPSHOT_SOURCE'],
  ['extra processEnv', 'registration', (text) => text.replace('{', '{ processEnv: {},'), 'CONFIG_RECIPE_SNAPSHOT_SOURCE'],
  ['forRoot input wiring', 'wiring', () => 'configSources', 'CONFIG_RECIPE_REGISTRATION'],
  ['adapter snapshot', 'adapter', () => 'Number(process.env.PORT)', 'CONFIG_RECIPE_ADAPTER_SNAPSHOT'],
  ['registration spread', 'registration', (text) => text.replace('{', '{ ...configSources,'), 'CONFIG_RECIPE_REGISTRATION'],
  ['duplicate registration member', 'registration', (text) => text.replace('{', '{ runtimeOverrides: configSources,'), 'CONFIG_RECIPE_REGISTRATION'],
];

describe('NestJS config migration documentation', () => {
  it('maps the source-backed ConfigModule registration contract in both locales', () => {
    // Given
    const loadSource = read('packages/config/src/load.ts');
    const moduleSource = read('packages/config/src/module.ts');
    const serviceSource = read('packages/config/src/service.ts');
    const typesSource = read('packages/config/src/types.ts');
    const englishReadme = read('packages/config/README.md');
    const koreanReadme = read('packages/config/README.ko.md');
    const runtimeSource = read('packages/runtime/src/bootstrap.ts');
    const englishMigration = read('docs/getting-started/migrate-from-nestjs.md');
    const koreanMigration = read('docs/getting-started/migrate-from-nestjs.ko.md');

    // When
    const migrationDocs = [englishMigration, koreanMigration] as const;

    // Then
    expect(loadSource).toContain('mergeConfigEntries(targetValue, sourceValue);');
    expect(loadSource).toContain('options.safeProcessEnv');
    expect(loadSource).toContain('return validateConfig(options, buildMergedConfig(options));');
    expect(moduleSource).toContain('static forRoot(options?: ConfigModuleOptions)');
    expect(moduleSource).toContain('global: loadOptions.global ?? true');
    expect(serviceSource).toContain("const parts = key.split('.');");
    expect(typesSource).toContain('export type ConfigProcessEnv = Record<string, string | undefined>');
    expect(typesSource).toContain('processEnv?: ConfigProcessEnv');
    expect(typesSource).toContain('schema?: ConfigSchema');
    expect(typesSource).toContain('global?: boolean');
    expect(englishReadme).toContain('### NestJS Registration Migration');
    expect(englishReadme).toContain('ConfigModule.forRootAsync(...)');
    expect(englishReadme).toContain('NestJS `load` factories');
    expect(englishReadme).toContain('explicit `processEnv` snapshot');
    expect(englishReadme).toContain('synchronous Standard Schema');
    expect(englishReadme).toContain('`global`, not NestJS `isGlobal`');
    expect(englishReadme).toContain('../../docs/getting-started/migrate-from-nestjs.md');
    expect(koreanReadme).toContain('### NestJS 등록 마이그레이션');
    expect(koreanReadme).toContain('ConfigModule.forRootAsync(...)');
    expect(koreanReadme).toContain('NestJS `load` factory');
    expect(koreanReadme).toContain('명시적 `processEnv` snapshot');
    expect(koreanReadme).toContain('동기 Standard Schema');
    expect(koreanReadme).toContain('NestJS `isGlobal`이 아니라 `global`');
    expect(koreanReadme).toContain('../../docs/getting-started/migrate-from-nestjs.ko.md');
    expect(runtimeSource).toContain('const hasHttpAdapter = effectiveOptions.adapter !== undefined;');
    expect(runtimeSource).toContain('Application cannot listen without an HTTP adapter.');

    for (const migrationDoc of migrationDocs) {
      expect(migrationDoc).toContain('@nestjs/config');
      expect(migrationDoc).toContain('ConfigModule.forRoot(...)');
      expect(migrationDoc).toContain('processEnv');
      expect(migrationDoc).toContain('Standard Schema');
      expect(migrationDoc).toContain('global?: boolean');
      expect(migrationDoc).toContain('FluoFactory.create(AppModule, { adapter })');
      expect(migrationDoc).toContain('FluoFactory.createApplicationContext(AppModule)');
      expect(migrationDoc).toContain("ConfigService.get('http.port')");
      expect(migrationDoc).not.toContain('flatten namespaced');
      expect(migrationDoc).not.toContain('namespaced result to flatten');
    }
  });

  it.each(recipePaths)('accepts wrapped, reordered registration properties in %s', (relativePath) => {
    const mutated = mutateRecipe(relativePath, 'registration', () =>
      '({ "runtimeOverrides": (validatedConfig), /* schema: ConfigSchema */ "envFilePaths": ([]), global: true })');
    expect(() => enforceConfigNestjsMigrationDocs((path) => path === relativePath ? mutated : read(path))).not.toThrow();
  });

  it.each(recipePaths.flatMap((path) => recipeMutations.map(([name, part, mutate, code]) =>
    [path, name, part, mutate, code] as const)))('rejects %s: %s independently', (relativePath, _name, part, mutate, code) => {
    const mutated = mutateRecipe(relativePath, part, mutate);
    expect(() => enforceConfigNestjsMigrationDocs()).not.toThrow();
    expect(() => enforceConfigNestjsMigrationDocs((path) => path === relativePath ? mutated : read(path)))
      .toThrowError(expect.objectContaining({ code, relativePath }));
  });

  it.each(recipePaths)('rejects a duplicate actual recipe in %s', (relativePath) => {
    const markdown = read(relativePath);
    const mutated = `${markdown}\n\`\`\`typescript\n${recipeFence(markdown)}\`\`\`\n`;
    expect(() => enforceConfigNestjsMigrationDocs((path) => path === relativePath ? mutated : read(path)))
      .toThrowError(expect.objectContaining({ code: 'CONFIG_RECIPE_ANCHOR', relativePath }));
  });

  it.each(recipePaths)('rejects a recipe replaced by a comment decoy in %s', (relativePath) => {
    const markdown = read(relativePath);
    const fence = recipeFence(markdown);
    const mutated = replaceOnce(markdown, fence, fence.split('\n').map((line) => `// ${line}`).join('\n'));
    expect(() => enforceConfigNestjsMigrationDocs((path) => path === relativePath ? mutated : read(path)))
      .toThrowError(expect.objectContaining({ code: 'CONFIG_RECIPE_ANCHOR', relativePath }));
  });

  it.each(['get', 'getOrThrow'] as const)(
    'rejects an added %s overload that leaves the single-key implementation intact',
    (methodName) => {
      // Given
      const mutated = mutateServiceSource(
        methodName,
        (implementationLine, indent) =>
          `${indent}${methodName}<K extends DotPaths<T>, D>(key: K, defaultValue?: D): DotValue<T, K & string> | D;\n${implementationLine}`,
      );

      // When
      const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

      // Then
      expect(runGovernanceGuard).toThrow(servicePath);
      expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
    },
  );

  it.each([
    ['get', 'defaultValue: DotValue<T, K & string>'],
    ['get', 'options: { infer: true }'],
    ['getOrThrow', 'defaultValue: DotValue<T, K & string>'],
    ['getOrThrow', 'options: { infer: true }'],
  ] as const)('rejects a second %s parameter declared as %s', (methodName, secondParameter) => {
    // Given
    const mutated = mutateServiceSource(methodName, (implementationLine) =>
      implementationLine.replace('(key: K)', `(key: K, ${secondParameter})`),
    );

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

    // Then
    expect(runGovernanceGuard).toThrow(servicePath);
    expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
  });

  it.each(['get', 'getOrThrow'] as const)(
    'rejects a declaration-merged interface overload that widens %s',
    (methodName) => {
      // Given
      const mutated = appendMergedInterfaceOverload(methodName);

      // When
      const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

      // Then
      expect(runGovernanceGuard).toThrow(servicePath);
      expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
    },
  );

  it('rejects an undefined-like void result for getOrThrow', () => {
    // Given
    const mutated = mutateServiceReturnType('getOrThrow', 'void');

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

    // Then
    expect(runGovernanceGuard).toThrow(servicePath);
    expect(runGovernanceGuard).toThrow('ConfigService.getOrThrow');
  });

  it.each([
    ['a parenthesized union', '(DotValue<T, K & string> | undefined)'],
    ['a union ordered undefined first', 'undefined | DotValue<T, K & string>'],
  ] as const)('accepts %s as the optional get result', (_shape, returnType) => {
    // Given
    const mutated = mutateServiceReturnType('get', returnType);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('accepts an alias that resolves to an optional get result', () => {
    // Given
    const aliased = `type MaybeValue<V> = V | undefined;\n${mutateServiceReturnType(
      'get',
      'MaybeValue<DotValue<T, K & string>>',
    )}`;

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(aliased));

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects a get result whose type cannot be resolved', () => {
    // Given
    const unresolvable = read(servicePath).replace(
      "import type { ConfigDictionary, DotPaths, DotValue } from './types.js';",
      '',
    );

    expect(unresolvable, 'expected the type-import fixture to change the service source').not.toBe(
      read(servicePath),
    );

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(unresolvable));

    // Then
    expect(runGovernanceGuard).toThrow(servicePath);
  });

  it.each(['get', 'getOrThrow'] as const)(
    'rejects a reformatted multi-line %s signature that adds a second parameter',
    (methodName) => {
      // Given
      const mutated = mutateServiceSource(methodName, (implementationLine, indent) =>
        implementationLine.replace(
          '(key: K)',
          `(\n${indent}  key: K,\n${indent}  options: { infer: true },\n${indent})`,
        ),
      );

      // When
      const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

      // Then
      expect(runGovernanceGuard).toThrow(servicePath);
      expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
    },
  );

  it('keeps the listen-only adapter boundary explicit in the bilingual config chapter', () => {
    // Given
    const englishChapter = read('book/beginner/ch11-config.md');
    const koreanChapter = read('book/beginner/ch11-config.ko.md');

    // When
    const chapters = [englishChapter, koreanChapter] as const;

    // Then
    for (const chapter of chapters) {
      expect(chapter).toContain("import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';");
      expect(chapter).toContain('await app.listen();');
      expect(chapter).toContain('FluoFactory.createApplicationContext(AppModule)');
      expect(chapter).not.toContain('await app.listen(port);');
      expect(chapter).not.toContain('.parse(process.env.PORT)');
    }
  });

  it('keeps the config migration boundary discoverable from both context indexes', () => {
    // Given
    const englishContext = read('docs/CONTEXT.md');
    const koreanContext = read('docs/CONTEXT.ko.md');

    // When
    const contextDocs = [englishContext, koreanContext] as const;

    // Then
    for (const contextDoc of contextDocs) {
      expect(contextDoc).toContain('@nestjs/config');
      expect(contextDoc).toContain('book/beginner/ch11-config');
      expect(contextDoc).toContain('ConfigModule.forRoot(...)');
      expect(contextDoc).toContain('processEnv');
      expect(contextDoc).toContain('FluoFactory.createApplicationContext(AppModule)');
      expect(contextDoc).toContain('plain-object deep merge');
    }
  });

  it('passes the executable platform governance guard', () => {
    // Given
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('reports the governed file and markers when a contract surface drifts', () => {
    // Given
    const readWithoutConfigModule = (relativePath: string): string =>
      relativePath === 'packages/config/src/module.ts' ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithoutConfigModule);

    // Then
    expect(runGovernanceGuard).toThrow(/packages\/config\/src\/module\.ts.*static forRoot/);
  });

  it.each([
    ['packages/config/src/load.ts', 'mergeConfigEntries(targetValue, sourceValue);'],
    ['packages/runtime/src/bootstrap.ts', 'Application cannot listen without an HTTP adapter.'],
  ] as const)('reports source drift in %s', (driftedPath, expectedMarker) => {
    // Given
    const readWithoutSourceContract = (relativePath: string): string =>
      relativePath === driftedPath ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithoutSourceContract);

    // Then
    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(expectedMarker);
  });
});
