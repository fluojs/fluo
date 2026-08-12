import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const emailLifecycleRequirements = [
  [
    'packages/email/src/service.ts',
    ["this.lifecycleState === 'stopping'", "this.lifecycleState === 'stopped'", "this.lifecycleState === 'failed'", 'this.options.verifyOnModuleInit', "this.lifecycleState === 'created' || this.lifecycleState === 'starting'"],
  ],
  ['packages/email/README.md', ['verifyOnModuleInit: true', 'Once shutdown starts', 'EmailLifecycleError']],
  ['packages/email/README.ko.md', ['verifyOnModuleInit: true', 'shutdown이 시작된 뒤', 'EmailLifecycleError']],
  [
    'docs/reference/package-surface.md',
    ['unconditional', '`stopping`', '`stopped`', '`failed`', 'EmailLifecycleError', 'opt-in', 'verifyOnModuleInit', '`created`', '`starting`', 'Without that option'],
  ],
  [
    'docs/reference/package-surface.ko.md',
    ['항상', '`stopping`', '`stopped`', '`failed`', 'EmailLifecycleError', 'opt-in', 'verifyOnModuleInit', '`created`', '`starting`', '이 옵션이 없으면'],
  ],
  [
    'docs/CONTEXT.md',
    ['unconditional', '`stopping`', '`stopped`', '`failed`', 'EmailLifecycleError', 'opt-in', 'verifyOnModuleInit', '`created`', '`starting`', 'without that option'],
  ],
  [
    'docs/CONTEXT.ko.md',
    ['항상', '`stopping`', '`stopped`', '`failed`', 'EmailLifecycleError', 'opt-in', 'verifyOnModuleInit', '`created`', '`starting`', '이 옵션이 없으면'],
  ],
];

export function enforceEmailLifecycleDocsContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of emailLifecycleRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));
    if (missingMarkers.length > 0) {
      throw new Error(
        `Email lifecycle documentation contract check failed: ${relativePath} is missing ${missingMarkers.join(', ')}.`,
      );
    }
  }
}
