import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type ServiceIdentity = Readonly<{
  path: string;
  id: string;
  version: number;
}>;

type SourceFile = Readonly<{
  path: string;
  source: string;
}>;

type ServiceIdentityDiscoveryContext = Readonly<{
  checker: ts.TypeChecker;
  sourceFilesByPath: ReadonlyMap<string, ts.SourceFile>;
}>;

const expectedPublicServiceIdentities = [
  { path: 'packages/cache-manager/src/interceptor.ts', id: '@fluojs/cache-manager/CacheInterceptor', version: 1 },
  { path: 'packages/cache-manager/src/service.ts', id: '@fluojs/cache-manager/CacheService', version: 1 },
  { path: 'packages/config/src/module.ts', id: '@fluojs/config/ConfigReloadManager', version: 1 },
  { path: 'packages/config/src/service.ts', id: '@fluojs/config/ConfigService', version: 1 },
  { path: 'packages/cqrs/src/buses/command-bus.ts', id: '@fluojs/cqrs/CommandBusLifecycleService', version: 1 },
  { path: 'packages/cqrs/src/buses/event-bus.ts', id: '@fluojs/cqrs/CqrsEventBusService', version: 1 },
  { path: 'packages/cqrs/src/buses/query-bus.ts', id: '@fluojs/cqrs/QueryBusLifecycleService', version: 1 },
  { path: 'packages/discord/src/channel.ts', id: '@fluojs/discord/DiscordChannel', version: 1 },
  { path: 'packages/discord/src/service.ts', id: '@fluojs/discord/DiscordService', version: 1 },
  { path: 'packages/drizzle/src/database.ts', id: '@fluojs/drizzle/DrizzleDatabase', version: 1 },
  { path: 'packages/email/src/channel.ts', id: '@fluojs/email/EmailChannel', version: 1 },
  { path: 'packages/email/src/service.ts', id: '@fluojs/email/EmailService', version: 1 },
  { path: 'packages/event-bus/src/service.ts', id: '@fluojs/event-bus/EventBusService', version: 1 },
  { path: 'packages/i18n/src/service.ts', id: '@fluojs/i18n/I18nService', version: 1 },
  { path: 'packages/jwt/src/refresh/refresh-token.ts', id: '@fluojs/jwt/RefreshTokenService', version: 1 },
  { path: 'packages/jwt/src/service.ts', id: '@fluojs/jwt/JwtService', version: 1 },
  { path: 'packages/jwt/src/signing/signer.ts', id: '@fluojs/jwt/DefaultJwtSigner', version: 1 },
  { path: 'packages/jwt/src/signing/verifier.ts', id: '@fluojs/jwt/DefaultJwtVerifier', version: 1 },
  { path: 'packages/microservices/src/service.ts', id: '@fluojs/microservices/MicroserviceLifecycleService', version: 1 },
  { path: 'packages/mongoose/src/connection.ts', id: '@fluojs/mongoose/MongooseConnection', version: 1 },
  { path: 'packages/notifications/src/service.ts', id: '@fluojs/notifications/NotificationsService', version: 1 },
  { path: 'packages/passport/src/guard.ts', id: '@fluojs/passport/AuthGuard', version: 1 },
  { path: 'packages/prisma/src/service.ts', id: '@fluojs/prisma/PrismaService', version: 1 },
  { path: 'packages/redis/src/redis-service.ts', id: '@fluojs/redis/RedisService', version: 1 },
  { path: 'packages/slack/src/channel.ts', id: '@fluojs/slack/SlackChannel', version: 1 },
  { path: 'packages/slack/src/service.ts', id: '@fluojs/slack/SlackService', version: 1 },
  { path: 'packages/terminus/src/health-check.ts', id: '@fluojs/terminus/TerminusHealthService', version: 1 },
  { path: 'packages/throttler/src/guard.ts', id: '@fluojs/throttler/ThrottlerGuard', version: 1 },
] as const satisfies readonly ServiceIdentity[];

const inventoryMismatchError = 'Framework service identity inventory does not match the discovered source set.';
const canonicalIdentitySyntaxError = 'Framework service identity must use an inline canonical object literal';

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function discoverTypeScriptSources(directory: string, relativeDirectory: string): readonly SourceFile[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): readonly SourceFile[] => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      const absolutePath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        return discoverTypeScriptSources(absolutePath, relativePath);
      }

      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        return [];
      }

      return [{ path: relativePath, source: read(relativePath) }];
    });
}

function discoverGovernedSourceFiles(): readonly SourceFile[] {
  const packagesDirectory = resolve(repoRoot, 'packages');

  return readdirSync(packagesDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): readonly SourceFile[] => {
      const relativeDirectory = `packages/${entry.name}/src`;
      const sourceDirectory = resolve(repoRoot, relativeDirectory);

      if (!entry.isDirectory() || !existsSync(sourceDirectory)) {
        return [];
      }

      return discoverTypeScriptSources(sourceDirectory, relativeDirectory);
    });
}

function discoverServiceIdentities(sourceFiles: readonly SourceFile[]): readonly ServiceIdentity[] {
  const context = createServiceIdentityDiscoveryContext(sourceFiles);

  return sourceFiles
    .flatMap((sourceFile) => discoverSourceServiceIdentities(sourceFile, sourceFiles, context))
    .sort(compareIdentities);
}

function createServiceIdentityDiscoveryContext(
  sourceFiles: readonly SourceFile[],
): ServiceIdentityDiscoveryContext {
  const sourceTextsByPath = new Map(sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile.source]));
  const compilerHost: ts.CompilerHost = {
    fileExists: (path) => sourceTextsByPath.has(path),
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => '',
    getNewLine: () => '\n',
    getSourceFile: (path, languageVersion) => {
      const source = sourceTextsByPath.get(path);
      return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true);
    },
    readFile: (path) => sourceTextsByPath.get(path),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {},
  };
  const program = ts.createProgram({
    rootNames: sourceFiles.map((sourceFile) => sourceFile.path),
    options: { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest },
    host: compilerHost,
  });
  const parsedSourceFiles = new Map(
    sourceFiles.flatMap((sourceFile) => {
      const parsedSource = program.getSourceFile(sourceFile.path);
      return parsedSource ? [[sourceFile.path, parsedSource] as const] : [];
    }),
  );

  return { checker: program.getTypeChecker(), sourceFilesByPath: parsedSourceFiles };
}

function discoverSourceServiceIdentities(
  sourceFile: SourceFile,
  sourceFiles: readonly SourceFile[],
  context: ServiceIdentityDiscoveryContext,
): readonly ServiceIdentity[] {
  const parsedSource = context.sourceFilesByPath.get(sourceFile.path);

  if (!parsedSource) {
    return [];
  }

  const identities: ServiceIdentity[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const marker = frameworkServiceMarker(node, parsedSource, sourceFiles, context.checker);

      if (marker && !isFrameworkServiceImplementationRelay(node, sourceFile.path)) {
        identities.push({
          path: sourceFile.path,
          ...resolveServiceIdentity(node, marker, sourceFile.path),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parsedSource);
  return identities;
}

function frameworkServiceMarker(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourceFiles: readonly SourceFile[],
  checker: ts.TypeChecker,
): 'FrameworkService' | 'defineFrameworkServiceIdentity' | undefined {
  if (ts.isIdentifier(call.expression)) {
    return namedImportMarker(call.expression, sourceFile, sourceFiles, checker);
  }

  if (!ts.isPropertyAccessExpression(call.expression) || !ts.isIdentifier(call.expression.expression)) {
    return undefined;
  }

  const marker = markerName(call.expression.name.text);

  return marker && namespaceImportProvidesMarker(call.expression.expression, marker, sourceFile, sourceFiles, checker)
    ? marker
    : undefined;
}

function markerName(name: string): 'FrameworkService' | 'defineFrameworkServiceIdentity' | undefined {
  return name === 'FrameworkService' || name === 'defineFrameworkServiceIdentity' ? name : undefined;
}

function namedImportMarker(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
  sourceFiles: readonly SourceFile[],
  checker: ts.TypeChecker,
): 'FrameworkService' | 'defineFrameworkServiceIdentity' | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const bindings = statement.importClause.namedBindings;

    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      const marker = markerName(element.propertyName?.text ?? element.name.text);

      if (
        marker
        && identifierResolvesToImportBinding(identifier, element.name, checker)
        && moduleExportOriginatesFromCoreInternal(statement.moduleSpecifier.text, element.propertyName?.text ?? element.name.text, marker, sourceFiles)
      ) {
        return marker;
      }
    }
  }

  return undefined;
}

function namespaceImportProvidesMarker(
  identifier: ts.Identifier,
  marker: 'FrameworkService' | 'defineFrameworkServiceIdentity',
  sourceFile: ts.SourceFile,
  sourceFiles: readonly SourceFile[],
  checker: ts.TypeChecker,
): boolean {
  return sourceFile.statements.some((statement) => (
    ts.isImportDeclaration(statement)
    && statement.importClause
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.importClause.namedBindings
    && ts.isNamespaceImport(statement.importClause.namedBindings)
    && identifierResolvesToImportBinding(identifier, statement.importClause.namedBindings.name, checker)
    && moduleExportOriginatesFromCoreInternal(statement.moduleSpecifier.text, marker, marker, sourceFiles)
  ));
}

function identifierResolvesToImportBinding(
  identifier: ts.Identifier,
  importBinding: ts.Identifier,
  checker: ts.TypeChecker,
): boolean {
  const identifierSymbol = checker.getSymbolAtLocation(identifier);
  const importBindingSymbol = checker.getSymbolAtLocation(importBinding);

  return identifierSymbol !== undefined && identifierSymbol === importBindingSymbol;
}

function moduleExportOriginatesFromCoreInternal(
  moduleSpecifier: string,
  exportName: string,
  marker: 'FrameworkService' | 'defineFrameworkServiceIdentity',
  sourceFiles: readonly SourceFile[],
  visited = new Set<string>(),
): boolean {
  if (moduleSpecifier === '@fluojs/core/internal') {
    return exportName === marker;
  }

  const sourcePath = /^@fluojs\/([^/]+)\/internal$/.exec(moduleSpecifier)?.[1];

  if (!sourcePath || visited.has(`${moduleSpecifier}\u0000${exportName}`)) {
    return false;
  }

  visited.add(`${moduleSpecifier}\u0000${exportName}`);
  const sourceFile = sourceFiles.find((candidate) => candidate.path === `packages/${sourcePath}/src/internal.ts`);

  if (!sourceFile) {
    return false;
  }

  const parsedSource = ts.createSourceFile(sourceFile.path, sourceFile.source, ts.ScriptTarget.Latest, true);

  return parsedSource.statements.some((statement) => {
    if (
      !ts.isExportDeclaration(statement)
      || !statement.exportClause
      || !ts.isNamedExports(statement.exportClause)
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return false;
    }

    const moduleSpecifier = statement.moduleSpecifier;

    return statement.exportClause.elements.some((element) => (
      element.name.text === exportName
      && moduleExportOriginatesFromCoreInternal(
        moduleSpecifier.text,
        element.propertyName?.text ?? element.name.text,
        marker,
        sourceFiles,
        visited,
      )
    ));
  });
}

function isFrameworkServiceImplementationRelay(call: ts.CallExpression, sourcePath: string): boolean {
  for (let parent = call.parent; parent; parent = parent.parent) {
    if (!ts.isFunctionDeclaration(parent) || !parent.name) {
      continue;
    }

    if (
      sourcePath === 'packages/core/src/metadata/framework-service.ts'
      && (parent.name.text === 'FrameworkService' || parent.name.text === 'defineFrameworkServiceIdentity')
    ) {
      return true;
    }

    if (
      sourcePath === 'packages/runtime/src/internal/core-metadata.ts'
      && parent.name.text === 'defineRuntimeFrameworkServiceIdentity'
    ) {
      return true;
    }
  }

  return false;
}

function resolveServiceIdentity(
  call: ts.CallExpression,
  marker: 'FrameworkService' | 'defineFrameworkServiceIdentity',
  path: string,
): Omit<ServiceIdentity, 'path'> {
  const argumentIndex = marker === 'FrameworkService' ? 0 : 1;
  const identityExpression = call.arguments[argumentIndex];

  if (!identityExpression) {
    throw new Error(`${canonicalIdentitySyntaxError}: ${path}`);
  }

  const identityObject = ts.isObjectLiteralExpression(identityExpression) ? identityExpression : undefined;

  if (!identityObject) {
    throw new Error(`${canonicalIdentitySyntaxError}: ${path}`);
  }

  return readIdentityObject(identityObject, path);
}

function readIdentityObject(identityObject: ts.ObjectLiteralExpression, path: string): Omit<ServiceIdentity, 'path'> {
  let id: string | undefined;
  let version: number | undefined;

  for (const property of identityObject.properties) {
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property)) {
      throw new Error(`Framework service identity must use plain id and version properties: ${path}`);
    }

    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) {
      throw new Error(`Framework service identity must use plain id and version properties: ${path}`);
    }

    const name = property.name.text;

    if (name === 'id' && ts.isStringLiteral(property.initializer)) {
      id = property.initializer.text;
      continue;
    }

    if (name === 'version' && ts.isNumericLiteral(property.initializer)) {
      version = Number(property.initializer.text);
      continue;
    }

    throw new Error(`Framework service identity must use literal id and version properties: ${path}`);
  }

  if (id === undefined || version === undefined) {
    throw new Error(`Framework service identity must define literal id and version properties: ${path}`);
  }

  return { id, version };
}

function compareIdentities(left: ServiceIdentity, right: ServiceIdentity): number {
  return entryKey(left).localeCompare(entryKey(right));
}

function entryKey(identity: ServiceIdentity): string {
  return `${identity.path}\u0000${identity.id}\u0000${String(identity.version)}`;
}

function ownershipKey(identity: ServiceIdentity): string {
  return `${identity.id}\u0000${String(identity.version)}`;
}

function assertUniqueOwnership(identities: readonly ServiceIdentity[]): void {
  const ownership = new Set<string>();

  for (const identity of identities) {
    const key = ownershipKey(identity);
    if (ownership.has(key)) {
      throw new Error(`Framework service identity has more than one owner: ${key}`);
    }

    ownership.add(key);
  }
}

function assertExactDiscoveredSet(
  expected: readonly ServiceIdentity[],
  discovered: readonly ServiceIdentity[],
): void {
  assertUniqueOwnership(expected);
  assertUniqueOwnership(discovered);

  const expectedEntries = new Set(expected.map(entryKey));
  const discoveredEntries = new Set(discovered.map(entryKey));
  const missingExpected = [...expectedEntries].filter((entry) => !discoveredEntries.has(entry));
  const unlistedDiscovered = [...discoveredEntries].filter((entry) => !expectedEntries.has(entry));

  if (missingExpected.length > 0 || unlistedDiscovered.length > 0) {
    throw new Error('Framework service identity inventory does not match the discovered source set.');
  }
}

function assertRequiredContractCompanions(identities: readonly ServiceIdentity[]): void {
  const packageDirectories = new Set(identities.map((identity) => identity.path.split('/').slice(0, 2).join('/')));

  for (const packageDirectory of packageDirectories) {
    for (const name of ['README.md', 'README.ko.md']) {
      if (!existsSync(resolve(repoRoot, packageDirectory, name))) {
        throw new Error(`Framework service package contract companion is missing: ${packageDirectory}/${name}`);
      }
    }
  }
}

function replaceSource(
  sourceFiles: readonly SourceFile[],
  path: string,
  replacement: string,
): readonly SourceFile[] {
  return sourceFiles.map((sourceFile) => (
    sourceFile.path === path ? { ...sourceFile, source: replacement } : sourceFile
  ));
}

describe('duplicate-copy service token inventory', () => {
  const governedSourceFiles = discoverGovernedSourceFiles();

  it('matches the complete discovered public framework-service identity set', () => {
    assertExactDiscoveredSet(expectedPublicServiceIdentities, discoverServiceIdentities(governedSourceFiles));
  });

  it('keeps required EN and KO package contract companions available', () => {
    assertRequiredContractCompanions(expectedPublicServiceIdentities);
  });

  it('rejects dropped expected, version-drifted, duplicate, and unlisted service markers', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const marker = "@FrameworkService({ id: '@fluojs/cache-manager/CacheInterceptor', version: 1 })";
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);

    if (!sourceFile) {
      throw new Error(`Expected governed source file is missing: ${expectedIdentity.path}`);
    }

    expect(() => {
      assertExactDiscoveredSet(expectedPublicServiceIdentities.slice(1), discoverServiceIdentities(governedSourceFiles));
    }).toThrowError(new Error(inventoryMismatchError));
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          sourceFile.source.replace(marker, marker.replace('version: 1', 'version: 2')),
        )),
      );
    }).toThrowError(new Error(inventoryMismatchError));
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}\n${marker}`,
        )),
      );
    }).toThrowError(new Error(
      'Framework service identity has more than one owner: @fluojs/cache-manager/CacheInterceptor\u00001',
    ));
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}\n@FrameworkService({ id: '@fluojs/cache-manager/UnlistedService', version: 1 })`,
        )),
      );
    }).toThrowError(new Error(inventoryMismatchError));
  });

  it('rejects unlisted reversed, aliased, and namespace service markers', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);

    if (!sourceFile) {
      throw new Error('Expected governed source file is missing.');
    }

    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
@FrameworkService({ version: 1, id: '@fluojs/cache-manager/ReversedService' })`,
        )),
      );
    }).toThrowError(new Error(inventoryMismatchError));
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
import { FrameworkService as CoreFrameworkService } from '@fluojs/core/internal';
@CoreFrameworkService({ id: '@fluojs/cache-manager/AliasedService', version: 1 })
class AliasedService {}`,
        )),
      );
    }).toThrowError(new Error(inventoryMismatchError));
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
import * as CoreMetadata from '@fluojs/core/internal';
class NamespaceService {}
CoreMetadata.defineFrameworkServiceIdentity(NamespaceService, {
  id: '@fluojs/cache-manager/NamespaceService',
  version: 1,
});`,
        )),
      );
    }).toThrowError(new Error(inventoryMismatchError));
  });

  it('rejects indirect and shadowed identity expressions with the canonical-syntax guard', () => {
    const identitySourceFile = governedSourceFiles.find((file) => file.path === 'packages/config/src/service.ts');

    if (!identitySourceFile) {
      throw new Error('Expected governed source file is missing: packages/config/src/service.ts');
    }

    expect(() => {
      discoverServiceIdentities(replaceSource(
        governedSourceFiles,
        identitySourceFile.path,
        `${identitySourceFile.source}
const indirectIdentity = { id: '@fluojs/config/IndirectService', version: 1 };
class IndirectService {}
defineFrameworkServiceIdentity(IndirectService, indirectIdentity);`,
      ));
    }).toThrowError(new Error(`${canonicalIdentitySyntaxError}: ${identitySourceFile.path}`));
    expect(() => {
      discoverServiceIdentities(replaceSource(
        governedSourceFiles,
        identitySourceFile.path,
        `${identitySourceFile.source}
const outerIdentity = { id: '@fluojs/config/OuterIdentity', version: 1 };
function defineShadowedIdentity(
  identity: { readonly id: string; readonly version: number },
): void {
  class ShadowedIdentityService {}
  defineFrameworkServiceIdentity(ShadowedIdentityService, identity);
}`,
      ));
    }).toThrowError(new Error(`${canonicalIdentitySyntaxError}: ${identitySourceFile.path}`));
  });

  it('ignores locally shadowed and unrelated marker-named callees', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);
    const identitySourceFile = governedSourceFiles.find((file) => file.path === 'packages/config/src/service.ts');

    if (!sourceFile || !identitySourceFile) {
      throw new Error('Expected governed source file is missing.');
    }

    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
function invokeShadowedFrameworkService(
  FrameworkService: (identity: { readonly id: string; readonly version: number }) => void,
): void {
  FrameworkService({ id: '@fluojs/cache-manager/ShadowedService', version: 1 });
}`,
        )),
      );
    }).not.toThrow();
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          identitySourceFile.path,
          `${identitySourceFile.source}
function FrameworkService(_identity: { readonly id: string; readonly version: number }): void {}
FrameworkService({ id: '@fluojs/config/UnrelatedLocalService', version: 1 });`,
        )),
      );
    }).not.toThrow();
  });

  it('ignores marker-named callees bound by nested var and switch case declarations', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);

    if (!sourceFile) {
      throw new Error(`Expected governed source file is missing: ${expectedIdentity.path}`);
    }

    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
function invokeNestedVarShadow(): void {
  if (Math.random() > 0.5) {
    var FrameworkService = (_identity: { readonly id: string; readonly version: number }): void => {};
  }

  FrameworkService({ id: '@fluojs/cache-manager/NestedVarShadow', version: 1 });
}

function invokeSwitchCaseShadow(caseValue: number): void {
  switch (caseValue) {
    case 0:
      const FrameworkService = (_identity: { readonly id: string; readonly version: number }): void => {};
    case 1:
      FrameworkService({ id: '@fluojs/cache-manager/SwitchCaseShadow', version: 1 });
  }
}`,
        )),
      );
    }).not.toThrow();
  });

  it('ignores marker-named callees bound by local namespace, function, and class declarations', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);

    if (!sourceFile) {
      throw new Error(`Expected governed source file is missing: ${expectedIdentity.path}`);
    }

    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
import * as CoreMetadata from '@fluojs/core/internal';

function invokeLocalNamespaceShadow(
  CoreMetadata: {
    defineFrameworkServiceIdentity(
      service: unknown,
      identity: { readonly id: string; readonly version: number },
    ): void;
  },
): void {
  CoreMetadata.defineFrameworkServiceIdentity({}, {
    id: '@fluojs/cache-manager/NamespaceParameterShadow',
    version: 1,
  });
}

function invokeNamedFunctionShadow(): void {
  function FrameworkService(_identity: { readonly id: string; readonly version: number }): void {}

  FrameworkService({ id: '@fluojs/cache-manager/FunctionShadow', version: 1 });
}

function invokeNamedClassShadow(): void {
  class CoreMetadata {
    static defineFrameworkServiceIdentity(
      _service: unknown,
      _identity: { readonly id: string; readonly version: number },
    ): void {}
  }

  CoreMetadata.defineFrameworkServiceIdentity({}, {
    id: '@fluojs/cache-manager/ClassShadow',
    version: 1,
  });
}`,
        )),
      );
    }).not.toThrow();
  });

  it('ignores FrameworkService marker text in comments and strings', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);

    if (!sourceFile) {
      throw new Error(`Expected governed source file is missing: ${expectedIdentity.path}`);
    }

    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
// @FrameworkService({ version: 1, id: '@fluojs/cache-manager/CommentMention' })
const markerText = "@FrameworkService({ version: 1, id: '@fluojs/cache-manager/StringMention' })";`,
        )),
      );
    }).not.toThrow();
  });
});
