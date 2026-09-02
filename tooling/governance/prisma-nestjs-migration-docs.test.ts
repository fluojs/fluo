import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  enforcePrismaNestjsMigrationDocs,
  hasDirectMainBodyPrismaMigrationGuardCall,
} from './prisma-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS Prisma migration documentation', () => {
  it('keeps async registration and rollback guidance synchronized', () => {
    // Given
    const runGovernanceGuard = () => enforcePrismaNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects every removed or duplicated Prisma visibility contract anchor', () => {
    // Given
    const guardedDocumentationAnchors = [
      {
        path: 'docs/getting-started/migrate-from-nestjs.md',
        anchors: [
          '`PrismaModule.forRootAsync(...)` supports only the injected `inject` / `useFactory` factory strategy.',
          'Its top-level `name` and `global` options remain supported.',
          'Register each injected dependency through a surface visible to the async Prisma module before its options provider resolves:',
          'Registering `DatabaseConfig` only in the importing `AppModule`\'s `providers` is insufficient: the async child module can see only its local tokens, exports from its own imports, global module exports, and bootstrap runtime providers.',
          'Export injected dependencies from an imported `@Global()` module as above, or supply them as bootstrap runtime providers.',
          'NestJS `imports`, `useClass`, and `useExisting` are not `forRootAsync(...)` compatibility fields. Resolve their configuration, class construction, and provider aliases at application bootstrap or through explicit fluo provider registration, then pass the ready dependencies through `inject`.',
          'Set `strictTransactions: true` whenever migrated business work requires rollback atomicity. With its default `false` value, fluo runs the callback directly when the registered client does not expose interactive `$transaction(...)`, so `@Transaction()` and `requestTransaction(...)` do not provide rollback in that case.',
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
        path: 'docs/getting-started/migrate-from-nestjs.ko.md',
        anchors: [
          '`PrismaModule.forRootAsync(...)`는 injected `inject` / `useFactory` factory strategy만 지원합니다.',
          'Top-level `name`, `global` option은 계속 지원합니다.',
          'Prisma option provider가 resolve되기 전에 주입할 각 의존성을 async Prisma module에서 볼 수 있는 surface를 통해 등록합니다.',
          'Import하는 `AppModule`의 `providers`에만 `DatabaseConfig`를 등록하는 것으로는 충분하지 않습니다. Async child module은 자신의 local token, 자신의 import가 export한 token, global module export, bootstrap runtime provider만 볼 수 있습니다.',
          '위 예시처럼 주입 의존성을 import한 `@Global()` module에서 export하거나 bootstrap runtime provider로 제공하세요.',
          'NestJS의 `imports`, `useClass`, `useExisting`은 `forRootAsync(...)` 호환 field가 아닙니다. 해당 configuration, class construction, provider alias는 application bootstrap 또는 명시적인 fluo provider registration에서 해석하고, 준비된 의존성을 `inject`로 전달하세요.',
          '마이그레이션한 비즈니스 작업에 rollback 원자성이 필요하면 항상 `strictTransactions: true`를 설정하세요. 기본값 `false`에서는 등록한 client가 interactive `$transaction(...)`을 노출하지 않을 경우 fluo가 callback을 직접 실행하므로, 그 경우 `@Transaction()`과 `requestTransaction(...)`은 rollback을 보장하지 않습니다.',
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
    ] as const;

    for (const { path, anchors } of guardedDocumentationAnchors) {
      for (const anchor of anchors) {
        const readWithoutAnchor = (relativePath: string): string =>
          relativePath === path ? read(relativePath).replace(anchor, '') : read(relativePath);
        const readWithDuplicateAnchor = (relativePath: string): string =>
          relativePath === path ? read(relativePath).replace(anchor, `${anchor}\n${anchor}`) : read(relativePath);

        // When / Then
        expect(() => enforcePrismaNestjsMigrationDocs(readWithoutAnchor)).toThrow('exactly once');
        expect(() => enforcePrismaNestjsMigrationDocs(readWithDuplicateAnchor)).toThrow('exactly once');
      }
    }
  });

  it('rejects invalid parent-only DatabaseConfig registration', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.md';
    const readWithParentOnlyRegistration = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath)
          .replace('    DatabaseConfigModule,\n', '')
          .replace('  ],\n})\nclass AppModule {}', '  ],\n  providers: [DatabaseConfig],\n})\nclass AppModule {}')
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePrismaNestjsMigrationDocs(readWithParentOnlyRegistration);

    // Then
    expect(runGovernanceGuard).toThrow('exactly once');
  });

  it('requires the main governance body to invoke the Prisma guard', () => {
    // Given
    const governanceSource = read('tooling/governance/verify-platform-consistency-governance.mjs');
    const sourceWithNestedUncalledGuard = governanceSource.replace(
      '  enforcePrismaNestjsMigrationDocs();',
      '  const runPrismaMigrationGuardLater = () => enforcePrismaNestjsMigrationDocs();',
    );

    // When / Then
    expect(hasDirectMainBodyPrismaMigrationGuardCall(governanceSource)).toBe(true);
    expect(hasDirectMainBodyPrismaMigrationGuardCall(sourceWithNestedUncalledGuard)).toBe(false);
  });
});
