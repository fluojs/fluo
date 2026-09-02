import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const requirements = [
  [
    'docs/getting-started/migrate-from-nestjs.md',
    [
      '## Mongoose Root and Feature Migration',
      'create the concrete connection, compile models on that connection, then register the already-created connection with `MongooseModule`.',
      'MongooseModule.forRoot({',
      'strictTransactions: true,',
      '`MongooseConnection.model(...)` merges the ambient session',
      '`@Transaction((self: ReportingService) => self.analytics.conn)`',
    ],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    [
      '## Mongoose 루트와 feature 마이그레이션',
      'concrete connection을 생성하고 해당 connection에서 model을 compile한 다음, 이미 생성된 connection을 `MongooseModule`에 등록하세요.',
      'MongooseModule.forRoot({',
      'strictTransactions: true,',
      '`MongooseConnection.model(...)`은 기존 option field를 보존하면서 지원되는 facade 작업',
      '`@Transaction((self: ReportingService) => self.analytics.conn)`',
    ],
  ],
  [
    'docs/architecture/transactions.md',
    [
      '| Mongoose decorator target selection |',
      'It rejects multiple nested candidates rather than selecting one arbitrarily;',
      'Mongoose fail-open fallback applies only when the registered connection lacks both `connection.transaction(...)` and `startSession()` while `strictTransactions` is `false`;',
    ],
  ],
  [
    'docs/architecture/transactions.ko.md',
    [
      '| Mongoose decorator 대상 선택 |',
      '여러 중첩 후보 중 하나를 임의로 선택하지 않고 거부하므로,',
      'Mongoose fail-open fallback은 등록된 connection에 `connection.transaction(...)`과 `startSession()`이 모두 없고 `strictTransactions`가 `false`일 때만 적용됩니다.',
    ],
  ],
  [
    'docs/CONTEXT.md',
    [
      'NestJS Mongoose migration and transaction semantics are documented',
      '`MongooseConnection.model(...)` facade operations merge the ambient session',
      '`strictTransactions: false` can only fail open',
      '`@Transaction((self) => self.analytics.conn)`',
    ],
  ],
  [
    'docs/CONTEXT.ko.md',
    [
      'NestJS Mongoose 마이그레이션과 트랜잭션 의미론은',
      '`MongooseConnection.model(...)` facade 작업은 기존 option을 버리지 않고 ambient session을 병합',
      '`strictTransactions: false`의 fail-open은',
      '`@Transaction((self) => self.analytics.conn)`',
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
        `Platform consistency governance check failed: ${relativePath} must keep the Mongoose NestJS migration contract synchronized; missing: ${missingMarkers.join(', ')}.`,
      );
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enforceMongooseNestjsMigrationDocs();
}
