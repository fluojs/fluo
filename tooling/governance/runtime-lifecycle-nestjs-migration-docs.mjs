import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const runtimeRequirements = [
  [
    'packages/runtime/src/types.ts',
    [
      'export interface OnModuleInit',
      'onModuleInit(): MaybePromise<void>;',
      'export interface OnApplicationBootstrap',
      'onApplicationBootstrap(): MaybePromise<void>;',
      'export interface OnModuleDestroy',
      'onModuleDestroy(): MaybePromise<void>;',
      'export interface OnApplicationShutdown',
      'onApplicationShutdown(signal?: string): MaybePromise<void>;',
    ],
  ],
  [
    'packages/runtime/src/bootstrap.ts',
    [
      "hasMethod(value, 'onModuleInit')",
      "hasMethod(value, 'onApplicationBootstrap')",
      "hasMethod(value, 'onModuleDestroy')",
      "hasMethod(value, 'onApplicationShutdown')",
      'await instance.onModuleDestroy();',
      'await instance.onApplicationShutdown(signal);',
    ],
  ],
  [
    'packages/runtime/src/application.test.ts',
    [
      "'module:init'",
      "'app:bootstrap'",
      "'module:destroy'",
      "'app:shutdown:SIGTERM'",
      "'adapter:close:SIGTERM'",
    ],
  ],
];

const documentationRequirements = [
  ['packages/runtime/README.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['packages/runtime/README.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/getting-started/migrate-from-nestjs.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/getting-started/migrate-from-nestjs.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch08-module-graph.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch08-module-graph.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch09-app-context.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['book/advanced/ch09-app-context.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/CONTEXT.md', ['beforeApplicationShutdown', 'unsupported', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/CONTEXT.ko.md', ['beforeApplicationShutdown', '지원하지', 'onModuleDestroy()', 'onApplicationShutdown(signal?)', 'compatibility shim']],
  ['docs/architecture/lifecycle-and-shutdown.md', ['onModuleInit()', 'onApplicationBootstrap()', 'onModuleDestroy()', 'onApplicationShutdown(signal?)']],
  ['docs/architecture/lifecycle-and-shutdown.ko.md', ['onModuleInit()', 'onApplicationBootstrap()', 'onModuleDestroy()', 'onApplicationShutdown(signal?)']],
];

const contradictions = [
  {
    pattern: /beforeApplicationShutdown(?:\([^)]*\))?[^.\n]*(?:is|remains)\s+(?:supported|available|exposed|invoked)/iu,
    message: 'must not claim that beforeApplicationShutdown is supported',
  },
  {
    pattern: /(?:use|enable|install)\s+(?:the\s+)?beforeApplicationShutdown\s+(?:compatibility\s+)?(?:shim|fallback|alias)/iu,
    message: 'must not imply a beforeApplicationShutdown compatibility shim',
  },
  {
    pattern: /beforeApplicationShutdown(?:\([^)]*\))?(?:은|는|이|가)?[^.\n]*(?:지원됩니다|제공됩니다|호출됩니다)/u,
    message: 'must not claim that beforeApplicationShutdown is supported',
  },
  {
    pattern: /beforeApplicationShutdown[^.\n]*(?:shim|fallback|alias)(?:을|를)?\s*(?:사용|활성화|설치)/iu,
    message: 'must not imply a beforeApplicationShutdown compatibility shim',
  },
];

export function enforceRuntimeLifecycleNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of runtimeRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Runtime lifecycle migration contract check failed: ${relativePath} is missing ${missingMarkers.join(', ')}.`,
      );
    }

    if (content.includes('beforeApplicationShutdown')) {
      throw new Error(
        `Runtime lifecycle migration contract check failed: ${relativePath} must not add beforeApplicationShutdown to the runtime hook surface.`,
      );
    }
  }

  for (const [relativePath, requiredMarkers] of documentationRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Runtime lifecycle migration contract check failed: ${relativePath} must keep the unsupported NestJS hook guidance synchronized; missing ${missingMarkers.join(', ')}.`,
      );
    }

    for (const { pattern, message } of contradictions) {
      if (pattern.test(content)) {
        throw new Error(`Runtime lifecycle migration contract check failed: ${relativePath} ${message}.`);
      }
    }
  }
}
