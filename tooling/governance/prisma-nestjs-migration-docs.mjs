import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSourceFile,
  isCallExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
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

const prismaDocumentationAnchors = [
  {
    relativePath: 'docs/getting-started/migrate-from-nestjs.md',
    heading: '### Prisma Async Registration and Rollback Guarantees',
    codeAnchors: [
      "import { Global, Module } from '@fluojs/core';",
      '@Global()',
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
      "import { Global, Module } from '@fluojs/core';",
      '@Global()',
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
      `${relativePath} must contain exactly one complete @Global() Prisma visibility example with exported DatabaseConfig, sibling-module import, and injected factory.`,
    );
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

export function enforcePrismaNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceDocumentationClaims(readText);
}
