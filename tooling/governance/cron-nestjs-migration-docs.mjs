import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const sourceContracts = [
  ['timezone-mapping', 'packages/cron/src/types.ts', ['timezone?: string;']],
  ['wait-for-completion', 'packages/cron/src/scheduler.ts', ['protect: options.protect']],
  ['unsupported-options', 'packages/cron/src/types.ts', ['export interface CronTaskOptions']],
  ['absolute-time', 'packages/cron/src/decorators.ts', ['export function Cron']],
  ['named-interval-timeout', 'packages/cron/src/decorators.ts', ['export function Interval', 'export function Timeout']],
  ['async-configuration', 'packages/cron/src/module.ts', ['static forRoot(options: CronModuleOptions = {}): ModuleType {']],
  ['global-visibility', 'packages/cron/src/module.ts', ['global: options.global ?? false']],
  ['category-switches', 'packages/cron/src/types.ts', ["export type SchedulingTaskKind = 'cron' | 'interval' | 'timeout';"]],
];

const documentationSurfaces = [
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
];

export function enforceCronNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [proposition, relativePath, sourceMarkers] of sourceContracts) {
    const content = readText(relativePath);
    const missingMarkers = sourceMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Platform consistency governance check failed: source contract ${proposition} in ${relativePath} is missing: ${missingMarkers.join(', ')}.`,
      );
    }
  }

  for (const relativePath of documentationSurfaces) {
    const content = readText(relativePath);

    for (const [proposition] of sourceContracts) {
      const marker = `<!-- fluo:cron-nestjs-migration: ${proposition} -->`;

      if (!content.includes(marker)) {
        throw new Error(
          `Platform consistency governance check failed: ${relativePath} must declare the @nestjs/schedule migration proposition ${proposition}.`,
        );
      }
    }
  }
}
