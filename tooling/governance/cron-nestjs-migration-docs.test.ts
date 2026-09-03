import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  cronNestjsMigrationOverlapProseClauses,
  cronNestjsMigrationOverlapProseSurfaces,
  enforceCronNestjsMigrationDocs,
} from './cron-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPropositions = [
  'timezone-mapping',
  'wait-for-completion',
  'unsupported-options',
  'absolute-time',
  'named-interval-timeout',
  'async-configuration',
  'global-visibility',
  'category-switches',
] as const;
const migrationDocumentationSurfaces = [
  'packages/cron/README.md',
  'packages/cron/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  'book/intermediate/ch12-cron.md',
  'book/intermediate/ch12-cron.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
] as const;
const sourceSemanticMutations = [
  ['timezone-mapping', 'packages/cron/src/types.ts', 'timezone?: string;', 'timezone?: number;'],
  ['wait-for-completion', 'packages/cron/src/service.ts', 'protect: true,', 'protect: false,'],
  ['wait-for-completion', 'packages/cron/src/service.ts', ' || taskState.running', ''],
  ['wait-for-completion', 'packages/cron/src/service.ts', 'taskState.running = false;', 'taskState.enabled = false;'],
  ['unsupported-options', 'packages/cron/src/types.ts', 'timezone?: string;', 'timezone?: string;\n  waitForCompletion?: boolean;'],
  ['unsupported-options', 'packages/cron/src/types.ts', 'distributed?: boolean;', 'distributed?: boolean;\n  disabled?: boolean;'],
  ['absolute-time', 'packages/cron/src/decorators.ts', 'Cron(expression: string,', 'Cron(expression: string | Date,'],
  ['named-interval-timeout', 'packages/cron/src/decorators.ts', 'Interval(ms: number,', 'Interval(ms: string,'],
  ['named-interval-timeout', 'packages/cron/src/decorators.ts', 'Timeout(ms: number,', 'Timeout(ms: string,'],
  ['async-configuration', 'packages/cron/src/module.ts', '): ModuleType {', '): Promise<ModuleType> {'],
  ['async-configuration', 'packages/cron/src/module.ts', '  static forRoot(options:', '  static forRootAsync(): ModuleType { return CronModule.forRoot(); }\n\n  static forRoot(options:'],
  ['global-visibility', 'packages/cron/src/module.ts', 'global: options.global ?? false,', 'global: true,'],
  ['category-switches', 'packages/cron/src/types.ts', "'timeout';", "'timeout' | 'calendar';"],
  ['category-switches', 'packages/cron/src/types.ts', 'global?: boolean;', 'global?: boolean;\n  cronJobs?: unknown;'],
] as const;
const visibleGuidance = {
  en: {
    'timezone-mapping': '`timeZone` maps to `timezone`; `CronTaskOptions.timezone` is a string.',
    'wait-for-completion': '`protect: true` prevents overlapping Croner invocations, and `CronLifecycleService` rejects a tick while its task is running.',
    'unsupported-options': 'NestJS scheduler options other than the documented fluo options are unsupported.',
    'absolute-time': '`@Cron` accepts a cron-expression string only; `Date` and `DateTime` overloads are unsupported.',
    'named-interval-timeout': '`@Interval(ms, options)` and `@Timeout(ms, options)` accept milliseconds and optional named task options.',
    'async-configuration': '`CronModule.forRoot(...)` is synchronous; resolve async configuration before calling it.',
    'global-visibility': '`CronModule.forRoot(...)` is local by default; pass `global: true` explicitly when needed.',
    'category-switches': '`cronJobs`, `intervals`, and `timeouts` category switches are unsupported.',
  },
  ko: {
    'timezone-mapping': '`timeZone`은 `timezone`으로 매핑되며 `CronTaskOptions.timezone`은 문자열입니다.',
    'wait-for-completion': '`protect: true`가 Croner 호출의 중복을 막고 `CronLifecycleService`는 작업 실행 중 tick을 거부합니다.',
    'unsupported-options': '문서화된 fluo 옵션 외 NestJS scheduler 옵션은 지원되지 않습니다.',
    'absolute-time': '`@Cron`은 cron-expression 문자열만 받고 `Date`와 `DateTime` overload는 지원되지 않습니다.',
    'named-interval-timeout': '`@Interval(ms, options)`와 `@Timeout(ms, options)`는 millisecond와 선택적 named task option을 받습니다.',
    'async-configuration': '`CronModule.forRoot(...)`는 동기식이며 async configuration은 호출 전에 해석합니다.',
    'global-visibility': '`CronModule.forRoot(...)`는 기본적으로 local이고 필요할 때 `global: true`를 명시합니다.',
    'category-switches': '`cronJobs`, `intervals`, `timeouts` category switch는 지원되지 않습니다.',
  },
} as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS schedule migration documentation', () => {
  it('keeps the source-backed migration identifiers synchronized', () => {
    expect(() => enforceCronNestjsMigrationDocs()).not.toThrow();
  });

  it.each(
    migrationDocumentationSurfaces.flatMap((relativePath) =>
      migrationPropositions.map((proposition) => [relativePath, proposition] as const),
    ),
  )('reports the missing %s migration proposition in %s', (driftedPath, proposition) => {
    const marker = `<!-- fluo:cron-nestjs-migration: ${proposition} -->`;
    const readWithoutMigrationProposition = (relativePath: string): string =>
      relativePath === driftedPath ? read(relativePath).replace(marker, '') : read(relativePath);

    const runGovernanceGuard = () => enforceCronNestjsMigrationDocs(readWithoutMigrationProposition);

    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(proposition);
  });

  it.each(sourceSemanticMutations)(
    'rejects the %s source semantic mutation in %s',
    (proposition, driftedPath, expectedSource, driftedSource) => {
      const readWithSourceDrift = (relativePath: string): string =>
        relativePath === driftedPath ? read(relativePath).replace(expectedSource, driftedSource) : read(relativePath);

      expect(() => enforceCronNestjsMigrationDocs(readWithSourceDrift)).toThrow(proposition);
    },
  );

  const overlapProseClauseCases: readonly [string, string, RegExp][] =
    cronNestjsMigrationOverlapProseSurfaces.flatMap((relativePath) =>
      cronNestjsMigrationOverlapProseClauses[relativePath.endsWith('.ko.md') ? 'ko' : 'en'].map(
        (clause): [string, string, RegExp] => [relativePath, clause.name, clause.pattern],
      ),
    );
  const overlapProseSurfaceCases: readonly [string][] = cronNestjsMigrationOverlapProseSurfaces.map(
    (relativePath): [string] => [relativePath],
  );

  it.each(overlapProseClauseCases)('rejects deleted wait-for-completion %s prose clause in %s', (driftedPath, clauseName, pattern) => {
    const readWithoutOverlapProse = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath)
            .split('\n')
            .filter((line) => !pattern.test(line.replaceAll(/<!--[\s\S]*?-->/g, '')))
            .join('\n')
        : read(relativePath);

    const runGovernanceGuard = () => enforceCronNestjsMigrationDocs(readWithoutOverlapProse);

    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow('wait-for-completion migration semantics clause');
    expect(clauseName).not.toHaveLength(0);
  });

  it.each(overlapProseSurfaceCases)(
    'rejects contradicted wait-for-completion overlap prose in %s',
    (driftedPath) => {
      const locale = driftedPath.endsWith('.ko.md') ? 'ko' : 'en';
      const clauses = cronNestjsMigrationOverlapProseClauses[locale];
      const readWithContradictedOverlapProse = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath)
              .split('\n')
              .filter((line) => {
                const visibleLine = line.replaceAll(/<!--[\s\S]*?-->/g, '');
                return !clauses.some((clause: { pattern: RegExp }) => clause.pattern.test(visibleLine));
              })
              .join('\n')
          : read(relativePath);

      expect(() => enforceCronNestjsMigrationDocs(readWithContradictedOverlapProse)).toThrow(
        'wait-for-completion migration semantics clause',
      );
    },
  );

  it.each(
    migrationDocumentationSurfaces.flatMap((relativePath) =>
      migrationPropositions.map((proposition) => [relativePath, proposition] as const),
    ),
  )('rejects contradictory visible %s guidance in %s', (driftedPath, proposition) => {
    const locale = driftedPath.endsWith('.ko.md') ? 'ko' : 'en';
    const stableRule = visibleGuidance[locale][proposition];
    const readWithContradictoryGuidance = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(stableRule, `NOT ${stableRule}`)
        : read(relativePath);

    expect(() => enforceCronNestjsMigrationDocs(readWithContradictoryGuidance)).toThrow(proposition);
  });
});
