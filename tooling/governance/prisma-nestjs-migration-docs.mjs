import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isPropertyAccessExpression,
  ScriptKind,
  ScriptTarget,
} from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const prismaContractFields = [
  'injected-factory-only',
  'top-level-name-global',
  'global-export-visibility',
  'bootstrap-provider-visibility',
  'no-nest-dynamic-options',
  'strict-transaction-rollback',
];
const prismaContractMarkerPattern = /^<!-- fluo-prisma-contract: ([a-z-]+(?:, [a-z-]+)*) -->$/gmu;
const prismaRegistrationContractFields = [
  'default-class-token-alias',
  'named-token-isolation',
  'no-transaction-interceptor-export',
];
const prismaRegistrationContractMarkerPattern =
  /^<!-- fluo-prisma-registration-contract: ([a-z-]+(?:, [a-z-]+)*) -->$/gmu;
const prismaTransactionBoundaryMarkerName = 'fluo-prisma-transaction-boundary';
const prismaTransactionBoundaryMarkerPattern = new RegExp(
  `^<!-- ${prismaTransactionBoundaryMarkerName}:\\s*([^\\r\\n]*?) -->$`,
  'gmu',
);
const prismaTransactionBoundaryFields = [
  ['interceptor', 'removed'],
  ['replacement', 'application-owned-request-transaction'],
];
const prismaRegistrationDocumentationPaths = [
  'docs/getting-started/migrate-prisma-registration.md',
  'docs/getting-started/migrate-prisma-registration.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
];
const prismaDocumentationAnchors = [
  {
    relativePath: 'docs/getting-started/migrate-from-nestjs.md',
    heading: '### Prisma Async Registration and Rollback Guarantees',
    codeAnchors: [
      "import { Module } from '@fluojs/core';",
      '  global: true,',
      '  providers: [DatabaseConfig],',
      '  exports: [DatabaseConfig],',
      'class DatabaseConfigModule {}',
      '    DatabaseConfigModule,',
      '    PrismaModule.forRootAsync({',
      '      inject: [DatabaseConfig],',
      '      useFactory: (config: DatabaseConfig) => ({',
    ],
  },
  {
    relativePath: 'docs/getting-started/migrate-from-nestjs.ko.md',
    heading: '### Prisma 비동기 등록과 롤백 보장',
    codeAnchors: [
      "import { Module } from '@fluojs/core';",
      '  global: true,',
      '  providers: [DatabaseConfig],',
      '  exports: [DatabaseConfig],',
      'class DatabaseConfigModule {}',
      '    DatabaseConfigModule,',
      '    PrismaModule.forRootAsync({',
      '      inject: [DatabaseConfig],',
      '      useFactory: (config: DatabaseConfig) => ({',
    ],
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function extractPrismaSection(markdown, relativePath, heading) {
  const headings = [...markdown.matchAll(new RegExp(`^${heading}\\s*$`, 'gmu'))];
  assert(headings.length === 1, `${relativePath} must contain exactly one ${heading} section.`);

  const matchedHeading = headings[0];
  const start = (matchedHeading.index ?? 0) + matchedHeading[0].length;
  const nextHeading = /(?:^|\n)#{1,3}\s+/mu.exec(markdown.slice(start));

  return markdown.slice(start, nextHeading ? start + nextHeading.index : undefined);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function countExactLineOccurrences(source, anchor) {
  return [...source.matchAll(new RegExp(`^${escapeRegExp(anchor)}$`, 'gmu'))].length;
}

function enforceExactlyOneAnchor(section, relativePath, anchor, kind) {
  const matches = countExactLineOccurrences(section, anchor);

  assert(
    matches === 1,
    `${relativePath} must contain the ${kind} anchor ${JSON.stringify(anchor)} exactly once in its Prisma async registration section; found ${matches}.`,
  );
}

function extractCodeBlocks(section) {
  return [...section.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map((match) => match[1]);
}

function enforcePrismaContractMarker(section, relativePath) {
  const markers = [...section.matchAll(prismaContractMarkerPattern)];

  assert(
    markers.length === 1,
    `${relativePath} must include exactly one fluo-prisma-contract marker; found ${markers.length}.`,
  );

  const fields = markers[0][1].split(', ');
  assert(
    fields.length === prismaContractFields.length &&
      new Set(fields).size === prismaContractFields.length &&
      prismaContractFields.every((field) => fields.includes(field)),
    `${relativePath} must declare each machine-consumed Prisma contract field exactly once.`,
  );
}

function enforcePrismaRegistrationContractMarker(markdown, relativePath) {
  const markers = [...markdown.matchAll(prismaRegistrationContractMarkerPattern)];

  assert(
    markers.length === 1,
    `${relativePath} must include exactly one fluo-prisma-registration-contract marker; found ${markers.length}.`,
  );

  const fields = markers[0][1].split(', ');
  assert(
    fields.length === prismaRegistrationContractFields.length &&
      new Set(fields).size === prismaRegistrationContractFields.length &&
      prismaRegistrationContractFields.every((field) => fields.includes(field)),
    `${relativePath} must declare each machine-consumed Prisma registration contract field exactly once.`,
  );
}

function enforcePrismaTransactionBoundaryMarker(markdown, relativePath) {
  const markers = [...markdown.matchAll(prismaTransactionBoundaryMarkerPattern)];

  assert(
    markers.length === 1,
    `${relativePath} must include exactly one ${prismaTransactionBoundaryMarkerName} marker; found ${markers.length}.`,
  );

  const fields = new Map();
  for (const rawField of markers[0][1].split(';')) {
    const separator = rawField.indexOf('=');
    assert(
      separator > 0,
      `${relativePath} ${prismaTransactionBoundaryMarkerName} marker fields must use key=value syntax.`,
    );

    const key = rawField.slice(0, separator).trim();
    const value = rawField.slice(separator + 1).trim();
    assert(
      key.length > 0 && value.length > 0 && !fields.has(key),
      `${relativePath} ${prismaTransactionBoundaryMarkerName} marker has an invalid or duplicate ${key || 'unnamed'} field.`,
    );
    fields.set(key, value);
  }

  assert(
    fields.size === prismaTransactionBoundaryFields.length &&
      prismaTransactionBoundaryFields.every(([key, value]) => fields.get(key) === value),
    `${relativePath} has unexpected Prisma transaction boundary fields.`,
  );
}

function enforceDocumentationClaims(readText) {
  for (const { relativePath, heading, codeAnchors } of prismaDocumentationAnchors) {
    const section = extractPrismaSection(readText(relativePath), relativePath, heading);

    enforcePrismaContractMarker(section, relativePath);

    for (const anchor of codeAnchors) {
      enforceExactlyOneAnchor(section, relativePath, anchor, 'code');
    }

    const completeVisibilityExamples = extractCodeBlocks(section).filter((codeBlock) =>
      codeAnchors.every((anchor) => countExactLineOccurrences(codeBlock, anchor) === 1));

    assert(
      completeVisibilityExamples.length === 1,
      `${relativePath} must contain exactly one complete @Module({ global: true }) Prisma visibility example with exported DatabaseConfig, sibling-module import, and injected factory.`,
    );
  }

  for (const relativePath of prismaRegistrationDocumentationPaths) {
    enforcePrismaRegistrationContractMarker(readText(relativePath), relativePath);
  }

  for (const { relativePath } of prismaDocumentationAnchors) {
    enforcePrismaTransactionBoundaryMarker(readText(relativePath), relativePath);
  }
}

export function hasDirectMainBodyPrismaMigrationGuardCall(source) {
  const sourceFile = createSourceFile(
    'verify-platform-consistency-governance.mjs',
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.JS,
  );
  const main = sourceFile.statements.find((statement) =>
    isFunctionDeclaration(statement) && statement.name?.text === 'main');

  return main?.body?.statements.some((statement) =>
    isExpressionStatement(statement) &&
    isCallExpression(statement.expression) &&
    isIdentifier(statement.expression.expression) &&
    statement.expression.expression.text === 'enforcePrismaNestjsMigrationDocs') ?? false;
}

export function hasPrismaRegistrationContractFieldComparison(source) {
  const sourceFile = createSourceFile(
    'prisma-nestjs-migration-docs.mjs',
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.JS,
  );
  const registrationGuard = sourceFile.statements.find((statement) =>
    isFunctionDeclaration(statement) &&
    statement.name?.text === 'enforcePrismaRegistrationContractMarker');
  let found = false;

  const visit = (node) => {
    if (
      isCallExpression(node) &&
      isPropertyAccessExpression(node.expression) &&
      isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'prismaRegistrationContractFields' &&
      node.expression.name.text === 'every' &&
      node.arguments.length === 1 &&
      node.arguments[0].getText(sourceFile) === '(field) => fields.includes(field)'
    ) {
      found = true;
    }
    forEachChild(node, visit);
  };

  if (registrationGuard) visit(registrationGuard);
  return found;
}

export function enforcePrismaNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceDocumentationClaims(readText);
}
