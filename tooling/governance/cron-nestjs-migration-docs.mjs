import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const requirements = [
  ['packages/cron/src/types.ts', ['timezone?: string;']],
  ['packages/cron/src/module.ts', [
    'static forRoot(options: CronModuleOptions = {}): ModuleType {',
    'global: options.global ?? false',
  ]],
  ['packages/cron/README.md', [
    '`utcOffset`, `unrefTimeout`, `disabled`, `threshold`, or `initialDelay`',
    '`@Cron(Date)` or `@Cron(DateTime)`',
    'ScheduleModule.forRootAsync(...)',
  ]],
  ['packages/cron/README.ko.md', [
    '`utcOffset`, `unrefTimeout`, `disabled`, `threshold`, `initialDelay`',
    '`@Cron(Date)` 또는 `@Cron(DateTime)`',
    'ScheduleModule.forRootAsync(...)',
  ]],
  ['docs/getting-started/migrate-from-nestjs.md', [
    '`utcOffset`, `unrefTimeout`, `disabled`, `threshold`, or `initialDelay`',
    'ScheduleModule.forRootAsync(...)',
    '`cronJobs`, `intervals`, or `timeouts` category switches',
  ]],
  ['docs/getting-started/migrate-from-nestjs.ko.md', [
    '`utcOffset`, `unrefTimeout`, `disabled`, `threshold`, `initialDelay`',
    'ScheduleModule.forRootAsync(...)',
    '`cronJobs`, `intervals`, `timeouts` category switch',
  ]],
  ['docs/contracts/nestjs-parity-gaps.md', ['absolute-time `@Cron` inputs']],
  ['docs/contracts/nestjs-parity-gaps.ko.md', ['absolute-time `@Cron` input']],
  ['book/intermediate/ch12-cron.md', ['`@Cron(Date)` and `@Cron(DateTime)`']],
  ['book/intermediate/ch12-cron.ko.md', ['`@Cron(Date)`와 `@Cron(DateTime)`']],
  ['docs/CONTEXT.md', ['NestJS category switches']],
  ['docs/CONTEXT.ko.md', ['NestJS category switch']],
];

export function enforceCronNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of requirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must keep the @nestjs/schedule migration boundary synchronized; missing: ${missingMarkers.join(', ')}.`,
      );
    }
  }
}
