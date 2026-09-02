import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const requirements = [
  [
    'docs/getting-started/migrate-from-nestjs.md',
    [
      '## Mongoose Root and Feature Migration',
      'MongooseConnection.saveDocument(...)',
      'return this.conn.saveDocument(document, { validateBeforeSave: false });',
      '`MongooseConnection.saveDocument(...)` is opt-in',
      '`doc.save()` itself is unchanged',
    ],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    [
      '## Mongoose 루트와 feature 마이그레이션',
      'MongooseConnection.saveDocument(...)',
      'return this.conn.saveDocument(document, { validateBeforeSave: false });',
      '`MongooseConnection.saveDocument(...)`는 opt-in입니다.',
      '`doc.save()` 자체는 변경되지 않으므로',
    ],
  ],
  [
    'docs/architecture/transactions.md',
    [
      '| Mongoose document save helper |',
      '`MongooseConnection.saveDocument(document, options?)`',
      'fails closed outside a transaction',
      'leaves native `doc.save()` unmodified',
    ],
  ],
  [
    'docs/architecture/transactions.ko.md',
    [
      '| Mongoose 문서 저장 helper |',
      '`MongooseConnection.saveDocument(document, options?)`',
      '트랜잭션 밖에서는 fail-closed',
      'native `doc.save()`는 수정하지 않습니다',
    ],
  ],
  [
    'docs/CONTEXT.md',
    [
      'NestJS Mongoose migration and transaction semantics are documented',
      '`MongooseConnection.saveDocument(...)` is the opt-in path',
      'leaves direct `doc.save()` unchanged',
    ],
  ],
  [
    'docs/CONTEXT.ko.md',
    [
      'NestJS Mongoose 마이그레이션과 트랜잭션 의미론은',
      '`MongooseConnection.saveDocument(...)`는 기존 document의 opt-in 경로',
      'direct `doc.save()`는 변경하지 않습니다',
    ],
  ],
];

export function enforceMongooseNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of requirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must keep the Mongoose document-save migration contract synchronized; missing: ${missingMarkers.join(', ')}.`,
      );
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enforceMongooseNestjsMigrationDocs();
}
