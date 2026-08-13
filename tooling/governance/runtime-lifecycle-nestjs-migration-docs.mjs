import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lifecycleInterfaceNames = new Set([
  'OnModuleInit',
  'OnApplicationBootstrap',
  'OnModuleDestroy',
  'OnApplicationShutdown',
]);
const lifecycleMethodNames = new Set([
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'onApplicationShutdown',
]);
const lifecycleMethodNamePattern = /^(?:on|before)[A-Z][A-Za-z0-9]*$/u;

const runtimeRequirements = [
  [
    'packages/runtime/src/types.ts',
    [
      'export interface OnModuleInit',
      'onModuleInit(): MaybePromise<void>;',
      'export interface OnApplicationBootstrap',
      'onApplicationBootstrap(): MaybePromise<void>;',
      'export interface OnModuleDestroy',
      'onModuleDestroy(): MaybePromise<void>;',
      'export interface OnApplicationShutdown',
      'onApplicationShutdown(signal?: string): MaybePromise<void>;',
    ],
  ],
  [
    'packages/runtime/src/bootstrap.ts',
    [
      "hasMethod(value, 'onModuleInit')",
      "hasMethod(value, 'onApplicationBootstrap')",
      "hasMethod(value, 'onModuleDestroy')",
      "hasMethod(value, 'onApplicationShutdown')",
      'await instance.onModuleDestroy();',
      'await instance.onApplicationShutdown(signal);',
    ],
  ],
  [
    'packages/runtime/src/application.test.ts',
    [
      "'module:init'",
      "'app:bootstrap'",
      "'module:destroy'",
      "'app:shutdown:SIGTERM'",
      "'adapter:close:SIGTERM'",
    ],
  ],
];

const documentationRequirements = [
  ['packages/runtime/README.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['packages/runtime/README.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/getting-started/migrate-from-nestjs.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/getting-started/migrate-from-nestjs.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch08-module-graph.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch08-module-graph.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch09-app-context.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch09-app-context.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/CONTEXT.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/CONTEXT.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/architecture/lifecycle-and-shutdown.md', ['onModuleInit()', 'onApplicationBootstrap()', 'onModuleDestroy()', 'onApplicationShutdown(signal?)']],
  ['docs/architecture/lifecycle-and-shutdown.ko.md', ['onModuleInit()', 'onApplicationBootstrap()', 'onModuleDestroy()', 'onApplicationShutdown(signal?)']],
];

const unsupportedHookPattern = /beforeApplicationShutdown(?:\s*\([^)]*\))?/iu;
const positiveSupportPattern =
  /\b(?:supports?|supported|available|exposed|invoked|provides?|provided)\b|(?:지원(?:됩니다|합니다|한다|하는|함|됨)|제공(?:됩니다|합니다|한다|하는|함|됨)|호출(?:됩니다|합니다|한다|하는|함|됨))/iu;
const compatibilityPattern = /\b(?:shim|fallback|alias)\b/iu;
const compatibilityActionPattern = /\b(?:use|enable|install|provide)\w*\b|(?:사용|활성화|설치|제공)/iu;
const explicitNegationPattern =
  /\b(?:not|no|never|without|unsupported|unavailable|forbidden|cannot)\b|\b\w+n't\b|(?:않|아니|없|금지|불가|마세요|하지)/iu;

function contradictionMessage(content) {
  const clauses = content.split(/[\n.!?;。！？；]+/u);

  for (const clause of clauses) {
    if (!unsupportedHookPattern.test(clause) || explicitNegationPattern.test(clause)) {
      continue;
    }
    if (positiveSupportPattern.test(clause)) {
      return 'must not claim that beforeApplicationShutdown is supported';
    }
    if (compatibilityPattern.test(clause) && compatibilityActionPattern.test(clause)) {
      return 'must not imply a beforeApplicationShutdown compatibility shim';
    }
  }

  return undefined;
}

function parseRuntimeSource(relativePath, content) {
  const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Runtime lifecycle migration contract check failed: ${relativePath} must remain valid TypeScript.`);
  }
  return sourceFile;
}

function assertExactNames({ relativePath, kind, actualNames, allowedNames }) {
  const unexpectedNames = [...actualNames].filter((name) => !allowedNames.has(name));
  const missingNames = [...allowedNames].filter((name) => !actualNames.has(name));
  if (unexpectedNames.length > 0 || missingNames.length > 0) {
    const differences = [
      ...(unexpectedNames.length > 0 ? [`unexpected ${unexpectedNames.join(', ')}`] : []),
      ...(missingNames.length > 0 ? [`missing ${missingNames.join(', ')}`] : []),
    ];
    throw new Error(
      `Runtime lifecycle migration contract check failed: ${relativePath} ${kind} must equal the four public lifecycle hooks; ${differences.join('; ')}.`,
    );
  }
}

function enforceLifecycleTypeAllowlist(relativePath, content) {
  const sourceFile = parseRuntimeSource(relativePath, content);
  const interfaceNames = new Set();
  const interfaceMethodNames = new Set();
  let lifecycleUnionNames = new Set();

  for (const statement of sourceFile.statements) {
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const hookMethodNames = statement.members
        .filter(ts.isMethodSignature)
        .map((member) => member.name)
        .filter(ts.isIdentifier)
        .map((identifier) => identifier.text)
        .filter((methodName) => lifecycleMethodNamePattern.test(methodName));
      if (hookMethodNames.length === 0) {
        continue;
      }
      interfaceNames.add(statement.name.text);
      for (const methodName of hookMethodNames) {
        interfaceMethodNames.add(methodName);
      }
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === 'LifecycleHooks') {
      const unionTypes = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type];
      lifecycleUnionNames = new Set(
        unionTypes
          .filter(ts.isTypeReferenceNode)
          .map((typeNode) => typeNode.typeName)
          .filter(ts.isIdentifier)
          .map((identifier) => identifier.text),
      );
    }
  }

  assertExactNames({ relativePath, kind: 'interface declarations', actualNames: interfaceNames, allowedNames: lifecycleInterfaceNames });
  assertExactNames({ relativePath, kind: 'interface methods', actualNames: interfaceMethodNames, allowedNames: lifecycleMethodNames });
  assertExactNames({ relativePath, kind: 'LifecycleHooks union', actualNames: lifecycleUnionNames, allowedNames: lifecycleInterfaceNames });
}

function enforceLifecycleBootstrapAllowlist(relativePath, content) {
  const sourceFile = parseRuntimeSource(relativePath, content);
  const probedMethodNames = new Set();
  const invokedMethodNames = new Set();

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'hasMethod' &&
        node.arguments.length >= 2 &&
        ts.isStringLiteral(node.arguments[1]) &&
        lifecycleMethodNamePattern.test(node.arguments[1].text)
      ) {
        probedMethodNames.add(node.arguments[1].text);
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'instance' &&
        lifecycleMethodNamePattern.test(node.expression.name.text)
      ) {
        invokedMethodNames.add(node.expression.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assertExactNames({ relativePath, kind: 'method probes', actualNames: probedMethodNames, allowedNames: lifecycleMethodNames });
  assertExactNames({ relativePath, kind: 'method invocations', actualNames: invokedMethodNames, allowedNames: lifecycleMethodNames });
}

export function enforceRuntimeLifecycleNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of runtimeRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Runtime lifecycle migration contract check failed: ${relativePath} is missing ${missingMarkers.join(', ')}.`,
      );
    }

    if (relativePath === 'packages/runtime/src/types.ts') {
      enforceLifecycleTypeAllowlist(relativePath, content);
    }
    if (relativePath === 'packages/runtime/src/bootstrap.ts') {
      enforceLifecycleBootstrapAllowlist(relativePath, content);
    }
  }

  for (const [relativePath, requiredMarkers] of documentationRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Runtime lifecycle migration contract check failed: ${relativePath} must keep the unsupported NestJS hook guidance synchronized; missing ${missingMarkers.join(', ')}.`,
      );
    }

    const message = contradictionMessage(content);
    if (message) {
      throw new Error(`Runtime lifecycle migration contract check failed: ${relativePath} ${message}.`);
    }
  }
}
