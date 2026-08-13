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
  /\b(?:supports?|supported|available|exposed|invoked)\b|(?:지원(?:됩니다|합니다|한다|하는|하지만|함|됨)|제공(?:됩니다|합니다|한다|하는|하지만|함|됨)|호출(?:됩니다|합니다|한다|하는|하지만|함|됨)|사용할\s+수\s+있|(?:사용|이용)\s*가능)/iu;
const positiveProvisionPattern = /\b(?:provides?|provided)\b/iu;
const compatibilityPattern = /\b(?:shim|fallback|alias)\b/iu;
const compatibilityActionPattern = /\b(?:use|enable|install|provide)\w*\b|(?:사용|활성화|설치|제공)/iu;
const negatedSupportPropositionPattern =
  /\b(?:do|does)\s+not\s+(?:claim|say|state|imply)\b[^\n.!?;]*(?:supports?|supported|available|exposed|invoked|provides?|provided)\b|\b(?:does?\s+not|cannot|never)\s+(?:support|provide|expose|invoke)\b|\b(?:is|remains)\s+(?:unsupported|(?:not|never)\b[^,\n.!?;]*(?:supported|available|exposed|invoked|provided))\b|\bprovides?\s+no\b|(?:지원|제공|호출)(?:하지(?!만)|되지)|(?:지원됩니다|지원합니다|제공됩니다|제공합니다|호출됩니다|호출합니다)[^\n.!?;]*(?:주장하지|말하지|마세요)/iu;
const negatedCompatibilityPropositionPattern =
  /\b(?:does?\s+not|cannot|never)\s+(?:use|enable|install|provide)\b|\b(?:provides?|offers?)\s+no\b|\b(?:no|without)\s+(?:compatibility\s+)?(?:shim|fallback|alias)\b|(?:사용|활성화|설치|제공)(?:하지|되지)|(?:shim|fallback|alias)[^\n.!?;]*(?:없|금지|불가)/iu;

function contradictionMessage(content) {
  const clauses = content.split(/[\n.!?;。！？；]+/u);

  for (const clause of clauses) {
    if (!unsupportedHookPattern.test(clause)) {
      continue;
    }
    for (const proposition of clause.split(/(?:,\s*|\s+)(?:but|however|yet)\s+|(?<=지만)\s*/iu)) {
      const hasCompatibilityTerms = compatibilityPattern.test(proposition);
      const hasPositiveSupport =
        positiveSupportPattern.test(proposition) ||
        (!hasCompatibilityTerms && positiveProvisionPattern.test(proposition));
      if (hasPositiveSupport && !negatedSupportPropositionPattern.test(proposition)) {
        return 'must not claim that beforeApplicationShutdown is supported';
      }
      if (
        hasCompatibilityTerms &&
        compatibilityActionPattern.test(proposition) &&
        !negatedCompatibilityPropositionPattern.test(proposition)
      ) {
        return 'must not imply a beforeApplicationShutdown compatibility shim';
      }
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

function staticName(node) {
  const nameNode = node && ts.isComputedPropertyName(node) ? node.expression : node;
  return nameNode && (ts.isIdentifier(nameNode) || ts.isStringLiteralLike(nameNode)) ? nameNode.text : undefined;
}

function unwrapExpression(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
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
        .map(staticName)
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
        unionTypes.map((typeNode) =>
          ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)
            ? typeNode.typeName.text
            : `unrecognized ${typeNode.getText(sourceFile)}`,
        ),
      );
    }
  }

  assertExactNames({ relativePath, kind: 'interface methods', actualNames: interfaceMethodNames, allowedNames: lifecycleMethodNames });
  assertExactNames({ relativePath, kind: 'interface declarations', actualNames: interfaceNames, allowedNames: lifecycleInterfaceNames });
  assertExactNames({ relativePath, kind: 'LifecycleHooks union', actualNames: lifecycleUnionNames, allowedNames: lifecycleInterfaceNames });
}

function enforceLifecycleBootstrapAllowlist(relativePath, content) {
  const sourceFile = parseRuntimeSource(relativePath, content);
  const probedMethodNames = new Set();
  const invokedMethodNames = new Set();

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const probeName = staticName(node.arguments[1]);
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'hasMethod' &&
        probeName &&
        lifecycleMethodNamePattern.test(probeName)
      ) {
        probedMethodNames.add(probeName);
      }
      const receiver =
        ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)
          ? unwrapExpression(node.expression.expression)
          : undefined;
      const invokedName = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isElementAccessExpression(node.expression)
          ? staticName(node.expression.argumentExpression)
          : undefined;
      if (
        receiver &&
        ts.isIdentifier(receiver) &&
        receiver.text === 'instance' &&
        invokedName &&
        lifecycleMethodNamePattern.test(invokedName)
      ) {
        invokedMethodNames.add(invokedName);
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
