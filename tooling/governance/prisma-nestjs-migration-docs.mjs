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

const prismaDocumentationAnchors = [
  {
    relativePath: 'docs/getting-started/migrate-from-nestjs.md',
    heading: '### Prisma Async Registration and Rollback Guarantees',
    proseAnchors: [
      '`PrismaModule.forRootAsync(...)` supports only the injected `inject` / `useFactory` factory strategy.',
      'Its top-level `name` and `global` options remain supported.',
      'Register each injected dependency through a surface visible to the async Prisma module before its options provider resolves:',
      'Registering `DatabaseConfig` only in the importing `AppModule`\'s `providers` is insufficient: the async child module can see only its local tokens, exports from its own imports, global module exports, and bootstrap runtime providers.',
      'Export injected dependencies from an imported `@Global()` module as above, or supply them as bootstrap runtime providers.',
      'NestJS `imports`, `useClass`, and `useExisting` are not `forRootAsync(...)` compatibility fields. Resolve their configuration, class construction, and provider aliases at application bootstrap or through explicit fluo provider registration, then pass the ready dependencies through `inject`.',
      'Set `strictTransactions: true` whenever migrated business work requires rollback atomicity. With its default `false` value, fluo runs the callback directly when the registered client does not expose interactive `$transaction(...)`, so `@Transaction()` and `requestTransaction(...)` do not provide rollback in that case.',
    ],
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
    proseAnchors: [
      '`PrismaModule.forRootAsync(...)`는 injected `inject` / `useFactory` factory strategy만 지원합니다.',
      'Top-level `name`, `global` option은 계속 지원합니다.',
      'Prisma option provider가 resolve되기 전에 주입할 각 의존성을 async Prisma module에서 볼 수 있는 surface를 통해 등록합니다.',
      'Import하는 `AppModule`의 `providers`에만 `DatabaseConfig`를 등록하는 것으로는 충분하지 않습니다. Async child module은 자신의 local token, 자신의 import가 export한 token, global module export, bootstrap runtime provider만 볼 수 있습니다.',
      '위 예시처럼 주입 의존성을 import한 `@Global()` module에서 export하거나 bootstrap runtime provider로 제공하세요.',
      'NestJS의 `imports`, `useClass`, `useExisting`은 `forRootAsync(...)` 호환 field가 아닙니다. 해당 configuration, class construction, provider alias는 application bootstrap 또는 명시적인 fluo provider registration에서 해석하고, 준비된 의존성을 `inject`로 전달하세요.',
      '마이그레이션한 비즈니스 작업에 rollback 원자성이 필요하면 항상 `strictTransactions: true`를 설정하세요. 기본값 `false`에서는 등록한 client가 interactive `$transaction(...)`을 노출하지 않을 경우 fluo가 callback을 직접 실행하므로, 그 경우 `@Transaction()`과 `requestTransaction(...)`은 rollback을 보장하지 않습니다.',
    ],
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

function enforceDocumentationClaims(readText) {
  for (const { relativePath, heading, proseAnchors, codeAnchors } of prismaDocumentationAnchors) {
    const section = extractPrismaSection(readText(relativePath), relativePath, heading);

    for (const anchor of proseAnchors) {
      enforceExactlyOneAnchor(section, relativePath, anchor, 'prose');
    }

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
