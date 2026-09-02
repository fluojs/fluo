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

const prismaDocumentationClaims = [
  [
    'docs/getting-started/migrate-from-nestjs.md',
    '### Prisma Async Registration and Rollback Guarantees',
    [
      /`PrismaModule\.forRootAsync\(\.\.\.\)` supports the injected-factory shape only/u,
      /Register each injected dependency through a surface visible to the async Prisma module/u,
      /NestJS `imports`, `useClass`, and `useExisting` are not `forRootAsync\(\.\.\.\)` compatibility fields/u,
      /Set `strictTransactions: true` whenever migrated business work requires rollback atomicity/u,
      /does not expose interactive `\$transaction\(\.\.\.\)`/u,
    ],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    '### Prisma 비동기 등록과 롤백 보장',
    [
      /`PrismaModule\.forRootAsync\(\.\.\.\)`는 injected-factory 형태만 지원합니다/u,
      /주입할 각 의존성을 async Prisma module에서 볼 수 있는 surface를 통해 등록합니다/u,
      /NestJS의 `imports`, `useClass`, `useExisting`은 `forRootAsync\(\.\.\.\)` 호환 field가 아닙니다/u,
      /rollback 원자성이 필요하면 항상 `strictTransactions: true`를 설정하세요/u,
      /interactive `\$transaction\(\.\.\.\)`을 노출하지 않을 경우/u,
    ],
  ],
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

function prose(section) {
  return section
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/\s+/gu, ' ');
}

function enforceDocumentationClaims(readText) {
  for (const [relativePath, heading, claims] of prismaDocumentationClaims) {
    const sectionProse = prose(extractPrismaSection(readText(relativePath), relativePath, heading));

    for (const claim of claims) {
      assert(
        claim.test(sectionProse),
        `${relativePath} must state ${claim} within its Prisma async registration section.`,
      );
    }
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
