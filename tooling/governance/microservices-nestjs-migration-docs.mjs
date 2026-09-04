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

import { enforceMicroservicesRuntimeEvidence } from './microservices-nestjs-migration-runtime-evidence.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationHeading = '### Microservices Handler and Transport Migration';

const documentationClaims = [
  [
    'docs/getting-started/migrate-from-nestjs.md',
    [
      /explicitly in a compiled module's `providers` or `controllers`/u,
      /@fluojs\/microservices\/tcp.*@fluojs\/microservices\/redis.*@fluojs\/microservices\/nats.*@fluojs\/microservices\/kafka.*@fluojs\/microservices\/rabbitmq.*@fluojs\/microservices\/grpc.*@fluojs\/microservices\/mqtt/u,
      /Event patterns fan out to all distinct matching handlers/u,
      /Overlapping message handlers fail deterministically/u,
      /Only repeated discovery of the same target method, handler kind, and pattern is ignored/u,
      /broker and TCP transports resolve at their publication or write boundary/u,
      /gRPC resolves only after the remote unary acknowledgement/u,
      /RedisPubSubMicroserviceTransport.*send\(\.\.\.\).*always returns a rejected Promise/u,
    ],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    [
      /compiled module의 `providers` 또는 `controllers`에 명시적으로/u,
      /@fluojs\/microservices\/tcp.*@fluojs\/microservices\/redis.*@fluojs\/microservices\/nats.*@fluojs\/microservices\/kafka.*@fluojs\/microservices\/rabbitmq.*@fluojs\/microservices\/grpc.*@fluojs\/microservices\/mqtt/u,
      /Event pattern은 서로 다른 모든 matching handler에 fan out/u,
      /겹치는 message handler.*결정론적으로 실패/u,
      /같은 target method.*반복 발견.*무시/u,
      /broker 및 TCP transport는 publication 또는 write boundary에서 resolve/u,
      /gRPC는 remote unary acknowledgement를 받은 뒤에만 resolve/u,
      /RedisPubSubMicroserviceTransport.*send\(\.\.\.\).*항상 reject된 Promise를 반환/u,
    ],
  ],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function extractMigrationSection(markdown, relativePath) {
  const headings = [...markdown.matchAll(/^### Microservices Handler and Transport Migration\s*$/gmu)];
  assert(headings.length === 1, `${relativePath} must contain exactly one ${migrationHeading} section.`);

  const heading = headings[0];
  const start = (heading.index ?? 0) + heading[0].length;
  const nextHeading = /(?:^|\n)#{1,3}\s+/mu.exec(markdown.slice(start));

  return markdown.slice(start, nextHeading ? start + nextHeading.index : undefined);
}

function migrationBulletLines(section) {
  return section
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/```[\s\S]*?```/gu, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
}

function enforceDocumentationClaims(readText) {
  for (const [relativePath, claims] of documentationClaims) {
    const bulletLines = migrationBulletLines(extractMigrationSection(readText(relativePath), relativePath));

    for (const claim of claims) {
      assert(
        bulletLines.some((line) => claim.test(line)),
        `${relativePath} must state ${claim} in a substantive list item within ${migrationHeading}.`,
      );
    }
  }
}

export function hasDirectMainBodyMigrationGuardCall(source) {
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
    statement.expression.expression.text === 'enforceMicroservicesNestjsMigrationDocs') ?? false;
}

export function enforceMicroservicesNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceMicroservicesRuntimeEvidence(readText);
  enforceDocumentationClaims(readText);
}
