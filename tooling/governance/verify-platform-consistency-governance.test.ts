import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  collectDirectProcessEnvViolations,
  collectNodeGlobalBufferViolations,
  enforceNoDirectProcessEnvInOrdinaryPackageSource,
  enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices,
  isGovernedPackageSourcePath,
  parsePackageNamesFromFamilyTable,
} from './verify-platform-consistency-governance.mjs';

type GitResult = { status: number; stdout: string };
type RunCommand = (command: string, args: string[], options?: { allowFailure?: boolean }) => GitResult;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const removedRuntimeModuleFactoryNames = [
  'createMicroservicesModule',
  'createCqrsModule',
  'createEventBusModule',
  'createRedisModule',
] as const;

function collectMarkdownFiles(relativeRoot: string): string[] {
  const absoluteRoot = resolve(repoRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const stack = [absoluteRoot];
  const markdownFiles: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.name.endsWith('.md')) {
        markdownFiles.push(fullPath);
      }
    }
  }

  return markdownFiles;
}

function requireWorkflowStepIndex(workflow: string, stepName: string): number {
  const index = workflow.indexOf(`- name: ${stepName}`);

  expect(index, `Expected workflow step "${stepName}" to exist`).toBeGreaterThanOrEqual(0);

  return index;
}

async function loadGovernanceInternals() {
  return (await import('./verify-platform-consistency-governance.mjs')) as unknown as {
    changedFilesFromGit: (runCommand?: RunCommand, env?: { GITHUB_BASE_REF?: string }) => string[];
    enforceAdvancedBookCoreBoundaryCompanions: (changedFiles: string[]) => void;
    enforceContractCompanionUpdates: (changedFiles: string[]) => void;
  };
}

describe('isGovernedPackageSourcePath', () => {
  it('includes ordinary package source files', () => {
    expect(isGovernedPackageSourcePath('packages/core/src/module.ts')).toBe(true);
  });

  it('excludes documented exceptions and non-governed paths', () => {
    expect(isGovernedPackageSourcePath('packages/cli/src/cli.ts')).toBe(false);
    expect(isGovernedPackageSourcePath('packages/cli/src/new/scaffold.ts')).toBe(false);
    expect(isGovernedPackageSourcePath('packages/core/src/module.test.ts')).toBe(false);
    expect(isGovernedPackageSourcePath('packages/core/src/module.spec.ts')).toBe(false);
    expect(isGovernedPackageSourcePath('packages/cli/scripts/local-test-env.mjs')).toBe(false);
    expect(isGovernedPackageSourcePath('examples/realworld-api/src/app.ts')).toBe(false);
  });
});

describe('collectDirectProcessEnvViolations', () => {
  it('reports only ordinary package-source process.env access', () => {
    const files = [
      'packages/core/src/module.ts',
      'packages/cli/src/cli.ts',
      'packages/cli/src/new/scaffold.ts',
      'packages/core/src/module.test.ts',
      'packages/cli/scripts/local-test-env.mjs',
    ];

    const sources = new Map([
      ['packages/core/src/module.ts', 'export const port = process.env.PORT;\n'],
      ['packages/cli/src/cli.ts', 'process.env.npm_config_user_agent;\n'],
      ['packages/cli/src/new/scaffold.ts', 'return `process.env.PORT`;\n'],
      ['packages/core/src/module.test.ts', 'process.env.PORT = "3000";\n'],
      ['packages/cli/scripts/local-test-env.mjs', 'resolveSandboxRoot(process.env);\n'],
    ]);

    expect(collectDirectProcessEnvViolations(files, (path: string) => sources.get(path) ?? '')).toEqual([
      {
        excerpt: 'export const port = process.env.PORT;',
        line: 1,
        path: 'packages/core/src/module.ts',
      },
    ]);
  });
});

describe('enforceNoDirectProcessEnvInOrdinaryPackageSource', () => {
  it('throws with actionable context when violations exist', () => {
    expect(() =>
      enforceNoDirectProcessEnvInOrdinaryPackageSource(
        ['packages/http/src/bad.ts'],
        () => 'const secret = process.env.JWT_SECRET;\n',
      ),
    ).toThrowError(/packages\/http\/src\/bad.ts:1/);
  });

  it('passes when only approved exceptions and tests use process.env', () => {
    expect(() =>
      enforceNoDirectProcessEnvInOrdinaryPackageSource(
        [
          'packages/cli/src/cli.ts',
          'packages/cli/src/new/scaffold.ts',
          'packages/runtime/src/node.test.ts',
        ],
        (path: string) => {
          if (path === 'packages/cli/src/cli.ts') {
            return 'process.env.npm_config_user_agent;\n';
          }

          if (path === 'packages/cli/src/new/scaffold.ts') {
            return 'return `process.env.PORT`;\n';
          }

          return 'process.env.PORT = "4321";\n';
        },
      ),
    ).not.toThrow();
  });
});

describe('collectNodeGlobalBufferViolations', () => {
  it('reports Buffer usage only in deno and cloudflare-workers service source files', () => {
    const files = [
      'packages/websockets/src/deno/deno-service.ts',
      'packages/websockets/src/cloudflare-workers/cloudflare-workers-service.ts',
      'packages/core/src/module.ts',
    ];

    const sources = new Map([
      ['packages/websockets/src/deno/deno-service.ts', 'const data = Buffer.from("hello");\n'],
      [
        'packages/websockets/src/cloudflare-workers/cloudflare-workers-service.ts',
        'export const size = Buffer.byteLength(payload);\n',
      ],
      ['packages/core/src/module.ts', 'const buf = Buffer.from("ignored");\n'],
    ]);

    expect(collectNodeGlobalBufferViolations(files, (path: string) => sources.get(path) ?? '')).toEqual([
      {
        excerpt: 'const data = Buffer.from("hello");',
        line: 1,
        path: 'packages/websockets/src/deno/deno-service.ts',
      },
      {
        excerpt: 'export const size = Buffer.byteLength(payload);',
        line: 1,
        path: 'packages/websockets/src/cloudflare-workers/cloudflare-workers-service.ts',
      },
    ]);
  });
});

describe('enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices', () => {
  it('throws with actionable context when Buffer is used in a service file', () => {
    expect(() =>
      enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices(
        ['packages/websockets/src/deno/deno-service.ts'],
        () => 'const data = Buffer.from(payload);\n',
      ),
    ).toThrowError(/packages\/websockets\/src\/deno\/deno-service\.ts:1/);
  });

  it('passes when service files use Web-standard alternatives instead of Buffer', () => {
    expect(() =>
      enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices(
        [
          'packages/websockets/src/deno/deno-service.ts',
          'packages/websockets/src/cloudflare-workers/cloudflare-workers-service.ts',
        ],
        () => 'const encoded = new TextEncoder().encode(payload);\n',
      ),
    ).not.toThrow();
  });
});

describe('officialTransportDocsPackages', () => {
  it('includes platform-socket.io for docs-hub transport discoverability enforcement', async () => {
    const governanceModule = (await import('./verify-platform-consistency-governance.mjs')) as unknown as {
      getOfficialTransportDocsPackages: () => string[];
    };

    expect(governanceModule.getOfficialTransportDocsPackages()).toContain('@fluojs/socket.io');
  });
});

describe('changedFilesFromGit', () => {
  it('fails closed when merge-base cannot be computed', async () => {
    const { changedFilesFromGit } = await loadGovernanceInternals();
    const runCommand = () => ({ status: 1, stdout: '' });

    expect(() => changedFilesFromGit(runCommand, { GITHUB_BASE_REF: 'main' })).toThrowError(
      /unable to compute merge-base with origin\/main/,
    );
  });

  it('fails closed when diff cannot be computed after merge-base resolves', async () => {
    const { changedFilesFromGit } = await loadGovernanceInternals();
    const results: GitResult[] = [
      { status: 0, stdout: 'abc123\n' },
      { status: 1, stdout: '' },
    ];
    const runCommand = () => results.shift() ?? { status: 1, stdout: '' };

    expect(() => changedFilesFromGit(runCommand, { GITHUB_BASE_REF: 'main' })).toThrowError(
      /unable to compute changed files from git diff/,
    );
  });

  it('returns changed files from the merge-base diff', async () => {
    const { changedFilesFromGit } = await loadGovernanceInternals();
    const calls: string[][] = [];
    const results: GitResult[] = [
      { status: 0, stdout: 'abc123\n' },
      { status: 0, stdout: 'docs/CONTEXT.md\n.github/workflows/ci.yml\n' },
      { status: 0, stdout: 'tooling/governance/verify-platform-consistency-governance.mjs\n' },
      { status: 0, stdout: 'tooling/governance/verify-platform-consistency-governance.test.ts\n' },
      { status: 0, stdout: 'packages/testing/src/conformance/platform-consistency-governance-docs.test.ts\n' },
    ];
    const runCommand = (_command: string, args: string[]) => {
      calls.push(args);
      return results.shift() ?? { status: 1, stdout: '' };
    };

    expect(changedFilesFromGit(runCommand, { GITHUB_BASE_REF: 'main' })).toEqual([
      '.github/workflows/ci.yml',
      'docs/CONTEXT.md',
      'packages/testing/src/conformance/platform-consistency-governance-docs.test.ts',
      'tooling/governance/verify-platform-consistency-governance.mjs',
      'tooling/governance/verify-platform-consistency-governance.test.ts',
    ]);
    expect(calls).toEqual([
      ['merge-base', 'HEAD', 'origin/main'],
      ['diff', '--name-only', 'abc123...HEAD'],
      ['diff', '--name-only'],
      ['diff', '--name-only', '--cached'],
      ['ls-files', '--others', '--exclude-standard'],
    ]);
  });
});

describe('enforceAdvancedBookCoreBoundaryCompanions', () => {
  it('requires advanced metadata chapter EN/KO companions to change together', async () => {
    const { enforceAdvancedBookCoreBoundaryCompanions } = await loadGovernanceInternals();

    expect(() => enforceAdvancedBookCoreBoundaryCompanions(['book/advanced/ch02-metadata.md'])).toThrowError(
      /book\/advanced\/ch02-metadata\.md and book\/advanced\/ch02-metadata\.ko\.md/,
    );
  });

  it('requires executable regression evidence for advanced core boundary book guidance', async () => {
    const { enforceAdvancedBookCoreBoundaryCompanions } = await loadGovernanceInternals();

    expect(() =>
      enforceAdvancedBookCoreBoundaryCompanions([
        'book/advanced/ch02-metadata.md',
        'book/advanced/ch02-metadata.ko.md',
        'book/advanced/ch03-custom-decorators.md',
        'book/advanced/ch03-custom-decorators.ko.md',
      ]),
    ).toThrowError(/executable regression evidence/);
  });

  it('accepts the advanced core boundary book range when package or governance regression tests change', async () => {
    const { enforceAdvancedBookCoreBoundaryCompanions } = await loadGovernanceInternals();

    expect(() =>
      enforceAdvancedBookCoreBoundaryCompanions([
        'book/advanced/ch02-metadata.md',
        'book/advanced/ch02-metadata.ko.md',
        'book/advanced/ch03-custom-decorators.md',
        'book/advanced/ch03-custom-decorators.ko.md',
        'packages/core/src/public-api.test.ts',
        'packages/core/src/request-pipeline-public-api.test.ts',
      ]),
    ).not.toThrow();
  });
});

describe('enforceContractCompanionUpdates', () => {
  it('requires discoverability, tooling or CI, and regression test updates for contract-governing docs', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() => enforceContractCompanionUpdates(['docs/reference/package-surface.md'])).toThrowError(
      /docs\/CONTEXT\.md and docs\/CONTEXT\.ko\.md/,
    );

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
      ]),
    ).toThrowError(/CI\/tooling enforcement updates/);

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        '.github/workflows/ci.yml',
      ]),
    ).toThrowError(/regression test updates/);

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        '.github/workflows/ci.yml',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts mongoose package-surface guidance when context discoverability and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'packages/mongoose/README.md',
        'packages/mongoose/README.ko.md',
        'docs/architecture/transactions.md',
        'docs/architecture/transactions.ko.md',
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/getting-started/migrate-from-nestjs.md',
        'docs/getting-started/migrate-from-nestjs.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'book/intermediate/ch19-mongoose.md',
        'book/intermediate/ch19-mongoose.ko.md',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts OpenAPI package-surface guidance when context and package regression tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/openapi/src/openapi-module.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts Queue dead-letter inspection guidance with bilingual docs and package regression coverage', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'packages/queue/README.md',
        'packages/queue/README.ko.md',
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'book/intermediate/ch11-queue.md',
        'book/intermediate/ch11-queue.ko.md',
        'packages/queue/src/dead-letter-manager.test.ts',
        'packages/queue/src/module.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts JWT package-surface guidance when context and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'packages/jwt/README.md',
        'packages/jwt/README.ko.md',
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'book/beginner/ch14-jwt.md',
        'book/beginner/ch14-jwt.ko.md',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts cron package-surface guidance when context discoverability and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/cron/src/status.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts Cron interval cadence package-surface guidance with package regression coverage', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/cron/src/module.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts Redis migration guidance when context discoverability and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/getting-started/migrate-from-nestjs.md',
        'docs/getting-started/migrate-from-nestjs.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('keeps Redis client creation and raw Pub/Sub shutdown ownership discoverable', () => {
    const englishReadme = readFileSync(join(repoRoot, 'packages/redis/README.md'), 'utf8');
    const koreanReadme = readFileSync(join(repoRoot, 'packages/redis/README.ko.md'), 'utf8');
    const englishBook = readFileSync(join(repoRoot, 'book/intermediate/ch03-redis-transport.md'), 'utf8');
    const koreanBook = readFileSync(join(repoRoot, 'book/intermediate/ch03-redis-transport.ko.md'), 'utf8');
    const englishMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
    const koreanMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');

    expect(englishReadme).toContain('does not adopt an externally constructed client');
    expect(koreanReadme).toContain('외부에서 만든 client instance를 채택하지는 않습니다');
    expect(englishBook).toContain('does not close the raw publisher or duplicate subscriber');
    expect(koreanBook).toContain('raw publisher나 duplicate subscriber를 닫지 않습니다');
    expect(englishMigration).toContain('creates a new lifecycle-managed client rather than adopting');
    expect(koreanMigration).toContain('새 lifecycle-managed client를 생성한다');
  });

  it('keeps HTTP DTO binding migration guidance present in governed docs', () => {
    const englishMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
    const koreanMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');

    for (const document of [englishMigration, koreanMigration, englishContext, koreanContext]) {
      expect(document).toContain('RequestDto');
      expect(document).toContain('ValidationPipe');
      expect(document).toContain('Convert');
      expect(document).toContain('DTO');
    }
  });

  it('accepts Email async-registration migration guidance when context, package, and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'packages/email/README.md',
        'packages/email/README.ko.md',
        'book/intermediate/ch16-email.md',
        'book/intermediate/ch16-email.ko.md',
        'docs/getting-started/migrate-from-nestjs.md',
        'docs/getting-started/migrate-from-nestjs.ko.md',
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/email/src/module.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts Notifications package-surface and Chapter 15 guidance when context and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'book/intermediate/ch15-notifications.md',
        'book/intermediate/ch15-notifications.ko.md',
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'tooling/governance/verify-platform-consistency-governance.mjs',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts Notifications migration boundary guidance when context and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'packages/notifications/README.md',
        'packages/notifications/README.ko.md',
        'book/intermediate/ch15-notifications.md',
        'book/intermediate/ch15-notifications.ko.md',
        'docs/getting-started/migrate-from-nestjs.md',
        'docs/getting-started/migrate-from-nestjs.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('keeps Email async-registration and visibility guidance present in governed docs', () => {
    const englishEmailReadme = readFileSync(join(repoRoot, 'packages/email/README.md'), 'utf8');
    const koreanEmailReadme = readFileSync(join(repoRoot, 'packages/email/README.ko.md'), 'utf8');
    const englishMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
    const koreanMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');

    for (const document of [englishEmailReadme, koreanEmailReadme, englishMigration, koreanMigration]) {
      expect(document).toContain('EmailModule.forRootAsync');
      expect(document).toContain('inject');
      expect(document).toContain('useFactory');
      expect(document).toContain('global: false');
      expect(document).toContain('imports');
      expect(document).toContain('useClass');
      expect(document).toContain('useExisting');
    }
  });

  it('keeps Slack injected-factory migration limits discoverable across package, migration, context, and book docs', () => {
    const slackReadme = readFileSync(join(repoRoot, 'packages/slack/README.md'), 'utf8');
    const slackReadmeKo = readFileSync(join(repoRoot, 'packages/slack/README.ko.md'), 'utf8');
    const nestjsMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
    const nestjsMigrationKo = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');
    const docsContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const slackBookChapter = readFileSync(join(repoRoot, 'book/intermediate/ch17-slack-discord.md'), 'utf8');
    const slackBookChapterKo = readFileSync(join(repoRoot, 'book/intermediate/ch17-slack-discord.ko.md'), 'utf8');

    const asyncRegistrationParagraphs = [
      slackReadme.split('\n\n').find((paragraph) => paragraph.startsWith('Async registration supports')) ?? '',
      slackReadmeKo.split('\n\n').find((paragraph) => paragraph.startsWith('Async registration은')) ?? '',
      slackBookChapter.split('\n\n').find((paragraph) => paragraph.startsWith('Async registration supports')) ?? '',
      slackBookChapterKo.split('\n\n').find((paragraph) => paragraph.startsWith('Async registration은')) ?? '',
    ];
    const migrationRows = [
      nestjsMigration.split('\n').find((line) => line.includes('NestJS Slack modules')) ?? '',
      nestjsMigrationKo.split('\n').find((line) => line.includes('NestJS Slack module')) ?? '',
    ];
    const contextParagraphs = [
      docsContext.split('\n\n').find((paragraph) => paragraph.startsWith('Slack discoverability')) ?? '',
      docsContextKo.split('\n\n').find((paragraph) => paragraph.startsWith('Slack discoverability')) ?? '',
    ];

    for (const section of [...asyncRegistrationParagraphs, ...migrationRows]) {
      expect(section).toContain('SlackModule.forRootAsync({ inject, useFactory, global? })');
      expect(section).toContain('imports');
      expect(section).toContain('useClass');
      expect(section).toContain('useExisting');
    }

    for (const section of contextParagraphs) {
      expect(section).toContain('SlackModule.forRoot(...)` / `forRootAsync(...)');
      expect(section).toContain('inject');
      expect(section).toContain('useFactory');
      expect(section).toContain('imports');
      expect(section).toContain('useClass');
      expect(section).toContain('useExisting');
    }
  });

  it('accepts Cron lifecycle and NestJS migration guidance when context and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/architecture/lifecycle-and-shutdown.md',
        'docs/architecture/lifecycle-and-shutdown.ko.md',
        'docs/getting-started/migrate-from-nestjs.md',
        'docs/getting-started/migrate-from-nestjs.ko.md',
        'docs/contracts/nestjs-parity-gaps.md',
        'docs/contracts/nestjs-parity-gaps.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts Cron NestJS option migration guidance when bilingual docs and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'packages/cron/README.md',
        'packages/cron/README.ko.md',
        'docs/getting-started/migrate-from-nestjs.md',
        'docs/getting-started/migrate-from-nestjs.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'book/intermediate/ch12-cron.md',
        'book/intermediate/ch12-cron.ko.md',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('treats Cron lifecycle and NestJS migration docs as contract-governing updates', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();
    const cronLifecycleTriggers = [
      'docs/architecture/lifecycle-and-shutdown.md',
      'docs/architecture/lifecycle-and-shutdown.ko.md',
      'docs/contracts/nestjs-parity-gaps.md',
      'docs/contracts/nestjs-parity-gaps.ko.md',
      'docs/getting-started/migrate-from-nestjs.md',
      'docs/getting-started/migrate-from-nestjs.ko.md',
    ];

    for (const trigger of cronLifecycleTriggers) {
      expect(() => enforceContractCompanionUpdates([trigger])).toThrowError(
        /contract-governing doc updates must include docs\/CONTEXT\.md and docs\/CONTEXT\.ko\.md/,
      );
    }
  });

  it('accepts Studio package-surface privacy and artifact guidance when paired with package tests', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/studio/src/contracts.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('treats observability and deployment docs as contract-governing updates', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();
    const observabilityAndDeploymentTriggers = [
      'docs/architecture/observability.md',
      'docs/architecture/observability.ko.md',
      'docs/contracts/deployment.md',
      'docs/contracts/deployment.ko.md',
    ];

    for (const trigger of observabilityAndDeploymentTriggers) {
      expect(() => enforceContractCompanionUpdates([trigger])).toThrowError(
        /docs\/CONTEXT\.md and docs\/CONTEXT\.ko\.md/,
      );

      expect(() =>
        enforceContractCompanionUpdates([
          trigger,
          'docs/CONTEXT.md',
          'docs/CONTEXT.ko.md',
          'packages/metrics/src/metrics-module.test.ts',
          'tooling/governance/verify-platform-consistency-governance.test.ts',
        ]),
      ).not.toThrow();
    }
  });

  it('accepts Vite package-chooser guidance when context discoverability and transform regression tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-chooser.md',
        'docs/reference/package-chooser.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/vite/src/index.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts testing-guide and package-surface guidance when context, testing regressions, and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/contracts/testing-guide.md',
        'docs/contracts/testing-guide.ko.md',
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/testing/src/module.test.ts',
        'packages/testing/src/portability/http-adapter-portability.test.ts',
        'packages/testing/src/conformance/platform-conformance.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('accepts Studio live package-surface guidance when context discoverability and live contract tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/studio/src/live-contracts.test.ts',
        'tooling/governance/verify-platform-consistency-governance.test.ts',
      ]),
    ).not.toThrow();
  });

  it('treats release governance publish-surface edits as contract-governing updates', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() => enforceContractCompanionUpdates(['docs/contracts/release-governance.md'])).toThrowError(
      /docs\/CONTEXT\.md and docs\/CONTEXT\.ko\.md/,
    );
  });
});

describe('repository governance contracts', () => {
  it('keeps Fastify runtime floor and HTTPS startup docs discoverable across governed docs', () => {
    const docsContext = readFileSync(resolve(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(resolve(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const packageChooser = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const packageChooserKo = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');
    const beginnerIntro = readFileSync(resolve(repoRoot, 'book/beginner/ch00-introduction.md'), 'utf8');
    const beginnerIntroKo = readFileSync(resolve(repoRoot, 'book/beginner/ch00-introduction.ko.md'), 'utf8');
    const beginnerCliSetup = readFileSync(resolve(repoRoot, 'book/beginner/ch02-cli-setup.md'), 'utf8');
    const beginnerCliSetupKo = readFileSync(resolve(repoRoot, 'book/beginner/ch02-cli-setup.ko.md'), 'utf8');
    const beginnerProduction = readFileSync(resolve(repoRoot, 'book/beginner/ch21-production.md'), 'utf8');
    const beginnerProductionKo = readFileSync(resolve(repoRoot, 'book/beginner/ch21-production.ko.md'), 'utf8');
    const fastifyReadme = readFileSync(resolve(repoRoot, 'packages/platform-fastify/README.md'), 'utf8');
    const fastifyReadmeKo = readFileSync(resolve(repoRoot, 'packages/platform-fastify/README.ko.md'), 'utf8');

    for (const source of [docsContext, packageSurface, packageChooser, beginnerIntro, beginnerCliSetup, beginnerProduction, fastifyReadme]) {
      expect(source).toContain('Node.js 20');
      expect(source).toContain('engines.node >=20.0.0');
    }

    for (const source of [docsContextKo, packageSurfaceKo, packageChooserKo, beginnerIntroKo, beginnerCliSetupKo, beginnerProductionKo, fastifyReadmeKo]) {
      expect(source).toContain('Node.js 20');
      expect(source).toContain('engines.node >=20.0.0');
    }

    for (const source of [docsContext, packageSurface, packageChooser, beginnerCliSetup, beginnerProduction, fastifyReadme]) {
      expect(source).toContain('https');
      expect(source).toMatch(/TLS|plain HTTP/u);
    }

    for (const source of [docsContextKo, packageSurfaceKo, packageChooserKo, beginnerCliSetupKo, beginnerProductionKo, fastifyReadmeKo]) {
      expect(source).toContain('https');
      expect(source).toMatch(/TLS|일반 HTTP/u);
    }

    for (const source of [docsContext, beginnerProduction, fastifyReadme, docsContextKo, beginnerProductionKo, fastifyReadmeKo]) {
      expect(source).toContain('createFastifyAdapter(...)');
      expect(source).toContain('bootstrapFastifyApplication(...)');
      expect(source).toContain('runFastifyApplication(...)');
    }
  });

  it('keeps Throttler guard activation and backing-store clock docs discoverable across governed docs', () => {
    const docsContext = readFileSync(resolve(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(resolve(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const throttlerReadme = readFileSync(resolve(repoRoot, 'packages/throttler/README.md'), 'utf8');
    const throttlerReadmeKo = readFileSync(resolve(repoRoot, 'packages/throttler/README.ko.md'), 'utf8');

    for (const source of [docsContext, packageSurface]) {
      expect(source).toContain('explicit `ThrottlerGuard` activation');
      expect(source).toContain('proxy-aware client identity controls');
      expect(source).toContain('shared route/client bucket semantics');
      expect(source).toContain('custom-store `retryAfterMs` support');
      expect(source).toContain('backing-store clocks');
    }

    expect(throttlerReadme).toContain('Activate `ThrottlerGuard`');
    expect(throttlerReadme).toContain('trusted reverse proxy');
    expect(throttlerReadme).toContain('route identity and client identity');
    expect(throttlerReadme).toContain('optional `retryAfterMs`');
    expect(throttlerReadme).toContain('authoritative clock');

    for (const source of [docsContextKo, packageSurfaceKo]) {
      expect(source).toContain('명시적 `ThrottlerGuard` 활성화');
      expect(source).toContain('proxy-aware client identity control');
      expect(source).toContain('공유 route/client bucket semantic');
      expect(source).toContain('custom-store `retryAfterMs` 지원');
      expect(source).toContain('backing-store clock');
    }

    expect(throttlerReadmeKo).toContain('`ThrottlerGuard`를 활성화');
    expect(throttlerReadmeKo).toContain('신뢰 가능한 리버스 프록시');
    expect(throttlerReadmeKo).toContain('route identity와 client identity');
    expect(throttlerReadmeKo).toContain('선택적 `retryAfterMs`');
    expect(throttlerReadmeKo).toContain('authoritative');
  });

  it('keeps Drizzle runtime, facade, and transaction migration docs discoverable across governed docs', () => {
    const docsContext = readFileSync(resolve(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(resolve(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const transactionsDoc = readFileSync(resolve(repoRoot, 'docs/architecture/transactions.md'), 'utf8');
    const transactionsDocKo = readFileSync(resolve(repoRoot, 'docs/architecture/transactions.ko.md'), 'utf8');
    const nestMigrationDoc = readFileSync(resolve(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
    const nestMigrationDocKo = readFileSync(resolve(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');
    const drizzleBook = readFileSync(resolve(repoRoot, 'book/intermediate/ch20-drizzle.md'), 'utf8');
    const drizzleBookKo = readFileSync(resolve(repoRoot, 'book/intermediate/ch20-drizzle.ko.md'), 'utf8');
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const packageChooser = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const packageChooserKo = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');
    const drizzleReadme = readFileSync(resolve(repoRoot, 'packages/drizzle/README.md'), 'utf8');
    const drizzleReadmeKo = readFileSync(resolve(repoRoot, 'packages/drizzle/README.ko.md'), 'utf8');

    for (const source of [docsContext, packageSurface, packageChooser, drizzleReadme]) {
      expect(source).toContain('Node.js 20+');
      expect(source).toContain('node:async_hooks');
      expect(source).toContain('engines.node >=20.0.0');
    }

    for (const source of [docsContextKo, packageSurfaceKo, packageChooserKo, drizzleReadmeKo]) {
      expect(source).toContain('Node.js 20+');
      expect(source).toContain('node:async_hooks');
      expect(source).toContain('engines.node >=20.0.0');
    }

    for (const source of [docsContext, packageSurface, drizzleReadme]) {
      expect(source).toContain('DrizzleDatabase.createFacade(...)');
      expect(source).toContain('compatibility-only');
      expect(source).toContain('DrizzleModule.forRoot(...)');
    }

    for (const source of [docsContextKo, packageSurfaceKo, drizzleReadmeKo]) {
      expect(source).toContain('DrizzleDatabase.createFacade(...)');
      expect(source).toMatch(/compatibility-only|호환성 전용/u);
      expect(source).toContain('DrizzleModule.forRoot(...)');
    }

    expect(packageChooser).toContain('Need Drizzle-based relational access on Node.js');
    expect(packageChooserKo).toContain('Node.js에서 Drizzle 기반 관계형 접근이 필요함');

    for (const source of [docsContext, packageSurface, packageChooser, drizzleBook, drizzleReadme]) {
      expect(source).toMatch(/raw Drizzle (?:driver handle|provider guidance|handle)/u);
      expect(source).toMatch(/Bun|Cloudflare/u);
    }

    for (const source of [docsContextKo, packageSurfaceKo, packageChooserKo, drizzleBookKo, drizzleReadmeKo]) {
      expect(source).toMatch(/raw Drizzle (?:driver handle|provider guidance|handle)/u);
      expect(source).toMatch(/Bun|Cloudflare/u);
    }

    expect(drizzleReadme).toContain('{ provide, useFactory }');
    expect(drizzleReadmeKo).toContain('{ provide, useFactory }');
    expect(drizzleBook).toContain('`DATABASE` token examples');
    expect(drizzleBookKo).toContain('`DATABASE` token 예시');

    for (const source of [docsContext, transactionsDoc, nestMigrationDoc, drizzleBook, drizzleReadme]) {
      expect(source).toContain('strictTransactions');
      expect(source).toContain('fail-open');
      expect(source).toContain('requestTransaction(...)');
      expect(source).toContain('@Transaction((self) => self.');
    }

    for (const source of [docsContextKo, transactionsDocKo, nestMigrationDocKo, drizzleBookKo, drizzleReadmeKo]) {
      expect(source).toContain('strictTransactions');
      expect(source).toContain('fail-open');
      expect(source).toContain('requestTransaction(...)');
      expect(source).toContain('@Transaction((self) => self.');
    }

    for (const source of [transactionsDoc, nestMigrationDoc, drizzleBook, drizzleReadme]) {
      expect(source).toMatch(/interceptor/i);
      expect(source).toContain('controller');
    }

    for (const source of [transactionsDocKo, nestMigrationDocKo, drizzleBookKo, drizzleReadmeKo]) {
      expect(source).toMatch(/interceptor/i);
      expect(source).toMatch(/controller|컨트롤러/u);
    }
  });

  it('keeps Mongoose ambient-session facade scope discoverable across governed docs', () => {
    const docsContext = readFileSync(resolve(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(resolve(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const transactionsDoc = readFileSync(resolve(repoRoot, 'docs/architecture/transactions.md'), 'utf8');
    const transactionsDocKo = readFileSync(resolve(repoRoot, 'docs/architecture/transactions.ko.md'), 'utf8');
    const nestMigrationDoc = readFileSync(resolve(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
    const nestMigrationDocKo = readFileSync(resolve(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');
    const mongooseBook = readFileSync(resolve(repoRoot, 'book/intermediate/ch19-mongoose.md'), 'utf8');
    const mongooseBookKo = readFileSync(resolve(repoRoot, 'book/intermediate/ch19-mongoose.ko.md'), 'utf8');
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const mongooseReadme = readFileSync(resolve(repoRoot, 'packages/mongoose/README.md'), 'utf8');
    const mongooseReadmeKo = readFileSync(resolve(repoRoot, 'packages/mongoose/README.ko.md'), 'utf8');

    for (const source of [docsContext, transactionsDoc, nestMigrationDoc, mongooseBook, packageSurface, mongooseReadme]) {
      expect(source).toContain('create`');
      expect(source).toContain('findOne`');
      expect(source).toContain('aggregate`');
      expect(source).toContain('bulkWrite`');
    }

    for (const source of [docsContextKo, transactionsDocKo, nestMigrationDocKo, mongooseBookKo, packageSurfaceKo, mongooseReadmeKo]) {
      expect(source).toContain('create`');
      expect(source).toContain('findOne`');
      expect(source).toContain('aggregate`');
      expect(source).toContain('bulkWrite`');
    }

    expect(transactionsDoc).toContain('Unsupported model methods, `doc.save()`');
    expect(transactionsDocKo).toContain('지원되지 않는 model 메서드, `doc.save()`');
    expect(nestMigrationDoc).toContain('Mongoose transaction migration is also not an interceptor-for-interceptor replacement');
    expect(nestMigrationDocKo).toContain('Mongoose transaction migration도 interceptor-for-interceptor 치환이 아니다');
    for (const source of [docsContext, transactionsDoc, nestMigrationDoc, mongooseBook, packageSurface, mongooseReadme]) {
      expect(source).toMatch(/concrete (?:Mongoose )?connection/u);
      expect(source).toContain('fail-open');
      expect(source).toContain('strictTransactions');
    }
    for (const source of [docsContextKo, transactionsDocKo, nestMigrationDocKo, mongooseBookKo, packageSurfaceKo, mongooseReadmeKo]) {
      expect(source).toMatch(/concrete (?:Mongoose )?connection/u);
      expect(source).toContain('fail-open');
      expect(source).toContain('strictTransactions');
    }
    for (const source of [docsContext, transactionsDoc, mongooseBook, mongooseReadme]) {
      expect(source).toContain('MongooseConnection.createPlatformStatusSnapshot()');
      expect(source).toContain('createMongoosePlatformStatusSnapshot(...)');
    }
    for (const source of [docsContextKo, transactionsDocKo, mongooseBookKo, mongooseReadmeKo]) {
      expect(source).toContain('MongooseConnection.createPlatformStatusSnapshot()');
      expect(source).toContain('createMongoosePlatformStatusSnapshot(...)');
    }
    expect(mongooseReadme).toContain('only merges the ambient `{ session }` into the correct options argument');
    expect(mongooseReadmeKo).toContain('올바른 options 인자에 ambient `{ session }`만 병합');
  });

  it('keeps Redis status helpers and Queue global scope controls discoverable across governed docs', () => {
    const docsContext = readFileSync(resolve(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(resolve(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const queueReadme = readFileSync(resolve(repoRoot, 'packages/queue/README.md'), 'utf8');
    const queueReadmeKo = readFileSync(resolve(repoRoot, 'packages/queue/README.ko.md'), 'utf8');

    expect(packageSurface).toContain('platform health/readiness status snapshot helpers');
    expect(packageSurfaceKo).toContain('platform health/readiness status snapshot helper');
    expect(docsContext).toContain('platform health/readiness status snapshot helper responsibility');
    expect(docsContextKo).toContain('platform health/readiness status snapshot helper 책임');

    expect(queueReadme).toContain('`global`: whether the queue module registration is global');
    expect(queueReadmeKo).toContain('`global`: queue module 등록을 global로 만들지 여부');
    expect(docsContext).toContain('`QueueModuleOptions.global` module-scope control');
    expect(docsContextKo).toContain('`QueueModuleOptions.global` module-scope control');
  });

  it('keeps the websockets README shutdown contract scoped to fetch-style runtimes with linked regression evidence', () => {
    const websocketsReadme = readFileSync(resolve(repoRoot, 'packages/websockets/README.md'), 'utf8');
    const websocketsReadmeKo = readFileSync(resolve(repoRoot, 'packages/websockets/README.ko.md'), 'utf8');

    expect(websocketsReadme).toContain('@fluojs/websockets/bun');
    expect(websocketsReadme).toContain('@fluojs/websockets/deno');
    expect(websocketsReadme).toContain('@fluojs/websockets/cloudflare-workers');
    expect(websocketsReadme).toContain('close tracked websocket clients during application shutdown');
    expect(websocketsReadme).toContain('bounded chance to finish within `shutdown.timeoutMs`');
    expect(websocketsReadme).not.toContain('Across Node.js, Bun, Deno, and Cloudflare Workers');
    expect(websocketsReadme).toContain('packages/websockets/src/bun/bun.test.ts');
    expect(websocketsReadme).toContain('packages/websockets/src/deno/deno.test.ts');
    expect(websocketsReadme).toContain('packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts');

    expect(websocketsReadmeKo).toContain('@fluojs/websockets/bun');
    expect(websocketsReadmeKo).toContain('@fluojs/websockets/deno');
    expect(websocketsReadmeKo).toContain('@fluojs/websockets/cloudflare-workers');
    expect(websocketsReadmeKo).toContain('애플리케이션 shutdown 시 추적 중인 websocket 클라이언트를 닫고');
    expect(websocketsReadmeKo).toContain('`shutdown.timeoutMs` 범위 안에서 `@OnDisconnect()` cleanup');
    expect(websocketsReadmeKo).not.toContain('Node.js, Bun, Deno, Cloudflare Workers 전반에서');
    expect(websocketsReadmeKo).toContain('packages/websockets/src/bun/bun.test.ts');
    expect(websocketsReadmeKo).toContain('packages/websockets/src/deno/deno.test.ts');
    expect(websocketsReadmeKo).toContain('packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts');
  });

  it('keeps PR CI governance-gated', () => {
    const ciWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const vitestConfig = readFileSync(resolve(repoRoot, 'vitest.config.ts'), 'utf8');

    expect(ciWorkflow).toContain('resolve-pr-verification-scope:');
    expect(ciWorkflow).toContain('run: node tooling/ci/detect-pr-verification-scope.mjs');
    expect(ciWorkflow).toContain("if: github.event_name == 'pull_request' && needs.resolve-pr-verification-scope.outputs.mode == 'scoped'");
    expect(ciWorkflow).toContain(
      'run: pnpm vitest run $' + '{{ needs.resolve-pr-verification-scope.outputs.test_paths }}',
    );
    expect(ciWorkflow).toContain("if: github.event_name != 'pull_request' || needs.resolve-pr-verification-scope.outputs.mode != 'scoped'");
    expect(ciWorkflow).toContain('run: pnpm vitest run --project packages');
    expect(ciWorkflow).toContain('run: pnpm vitest run --project apps');
    expect(ciWorkflow).toContain('run: pnpm vitest run --project examples');
    expect(ciWorkflow).toContain('run: pnpm vitest run --project tooling');
    expect(ciWorkflow).toContain('FLUO_VITEST_SHUTDOWN_DEBUG_DIR: .artifacts/vitest-shutdown-debug/packages');
    expect(ciWorkflow).toContain('FLUO_VITEST_SHUTDOWN_DEBUG_DIR: .artifacts/vitest-shutdown-debug/tooling');
    expect(ciWorkflow).toContain("hashFiles('.artifacts/vitest-shutdown-debug/**/*.json') != ''");
    expect(vitestConfig).toContain('passWithNoTests: true');
    expect(ciWorkflow).toContain('build-and-typecheck:');
    expect(ciWorkflow).toContain("if: github.event_name == 'pull_request'");
    expect(ciWorkflow).toContain('verify-platform-consistency-governance');
    expect(ciWorkflow).toMatch(/resolve-pr-verification-scope:[\s\S]*?- name: Checkout[\s\S]*?fetch-depth: 0/u);
    expect(ciWorkflow).toMatch(/verify-platform-consistency-governance:[\s\S]*?- name: Checkout[\s\S]*?fetch-depth: 0/u);
  });

  it('keeps Changesets release automation bound to main pushes and token-backed npm publish', () => {
    const releaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');

    expect(releaseWorkflow).toContain('name: Changesets Release');
    expect(releaseWorkflow).toContain('push:');
    expect(releaseWorkflow).toContain('- main');
    expect(releaseWorkflow).toContain('id-token: write');
    expect(releaseWorkflow).toContain('registry-url: https://registry.npmjs.org');
    expect(releaseWorkflow).toMatch(/uses: actions\/checkout@[0-9a-f]{40} # v5/u);
    expect(releaseWorkflow).toMatch(/uses: pnpm\/action-setup@[0-9a-f]{40} # v5/u);
    expect(releaseWorkflow).toMatch(/uses: actions\/setup-node@[0-9a-f]{40} # v5/u);
    expect(releaseWorkflow).toMatch(/uses: changesets\/action@[0-9a-f]{40} # v1/u);
    expect(releaseWorkflow).toContain('version: pnpm version-packages');
    expect(releaseWorkflow).toContain('publish: pnpm publish-packages');
    expect(releaseWorkflow).toContain('createGithubReleases: true');
    expect(releaseWorkflow).toContain('NPM_CONFIG_PROVENANCE: true');
    expect(releaseWorkflow).toContain(`NPM_TOKEN: \${{ secrets.NPM_TOKEN }}`);
    expect(releaseWorkflow).toContain(`NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`);
  });

  it('keeps Changesets release safety gates before versioning or publish', () => {
    const releaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');

    const checkout = requireWorkflowStepIndex(releaseWorkflow, 'Checkout');
    const installPnpm = requireWorkflowStepIndex(releaseWorkflow, 'Install pnpm');
    const setupNode = requireWorkflowStepIndex(releaseWorkflow, 'Setup Node.js');
    const installDependencies = requireWorkflowStepIndex(releaseWorkflow, 'Install dependencies');
    const buildPackages = requireWorkflowStepIndex(releaseWorkflow, 'Build packages');
    const releaseStep = requireWorkflowStepIndex(releaseWorkflow, 'Create Release Pull Request or Publish to npm');

    expect(releaseWorkflow).toContain('fetch-depth: 0');
    expect(releaseWorkflow).toContain('pnpm install --frozen-lockfile');
    expect(releaseWorkflow).toContain('run: pnpm build');

    expect(checkout).toBeLessThan(installPnpm);
    expect(installPnpm).toBeLessThan(setupNode);
    expect(setupNode).toBeLessThan(installDependencies);
    expect(installDependencies).toBeLessThan(buildPackages);
    expect(buildPackages).toBeLessThan(releaseStep);
  });

  it('keeps the legacy single-package workflow disabled for publish authority', () => {
    const legacyReleaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release-single-package.yml'), 'utf8');

    expect(legacyReleaseWorkflow).toContain('name: Deprecated single-package release');
    expect(legacyReleaseWorkflow).toContain('This workflow is deprecated and cannot publish packages');
    expect(legacyReleaseWorkflow).toContain('exit 1');
    expect(legacyReleaseWorkflow).not.toContain('pnpm publish');
    expect(legacyReleaseWorkflow).not.toContain('gh release create');
  });

  it('blocks removed runtime module factory names from docs/prose surfaces', () => {
    const markdownFiles = [
      ...collectMarkdownFiles('docs'),
      ...collectMarkdownFiles('packages'),
      ...collectMarkdownFiles('examples'),
    ];

    for (const markdownFile of markdownFiles) {
      const content = readFileSync(markdownFile, 'utf8');
      for (const removedName of removedRuntimeModuleFactoryNames) {
        expect(content).not.toContain(removedName);
      }
    }
  });
});

describe('parsePackageNamesFromFamilyTable', () => {
  it('collects all public package names from the family table', () => {
    const markdown = [
      '## public package families',
      '',
      '| family | description | packages |',
      '| --- | --- | --- |',
      '| **HTTP** | Web API execution and routing. | `@fluojs/http`, `@fluojs/graphql` |',
      '| **Auth** | Authentication and authorization. | `@fluojs/jwt`, `@fluojs/passport` |',
      '',
      '## next section',
    ].join('\n');

    expect(parsePackageNamesFromFamilyTable(markdown, 'public package families')).toEqual([
      '@fluojs/graphql',
      '@fluojs/http',
      '@fluojs/jwt',
      '@fluojs/passport',
    ]);
  });

  it('stops collecting once the next section begins', () => {
    const markdown = [
      '## public package families',
      '',
      '| family | description | packages |',
      '| --- | --- | --- |',
      '| **Patterns** | Messaging and architecture. | `@fluojs/notifications`, `@fluojs/email` |',
      '',
      '## package responsibilities',
      '- `@fluojs/email/node`: Node-only subpath',
    ].join('\n');

    expect(parsePackageNamesFromFamilyTable(markdown, 'public package families')).toEqual([
      '@fluojs/email',
      '@fluojs/notifications',
    ]);
  });
});

describe('package surface persistence responsibilities', () => {
  it('documents Mongoose ALS and session transaction ownership in both locales', () => {
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

    expect(englishSurface).toContain('**`@fluojs/mongoose`**');
    expect(englishSurface).toContain('ALS/session-aware transaction boundaries');
    expect(englishSurface).toContain('explicit `currentSession()` access');
    expect(koreanSurface).toContain('**`@fluojs/mongoose`**');
    expect(koreanSurface).toContain('ALS/session 인지형 transaction boundary');
    expect(koreanSurface).toContain('명시적 `currentSession()` 접근');
  });

  it('documents cache-manager configuration and helper responsibility in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(markdown).toContain('@fluojs/cache-manager');
      expect(markdown).toContain('CacheModule.forRoot(options)');
      expect(markdown).toContain('metadata helper');
      expect(markdown).toContain('status/diagnostic helper');
    }
  });
});

describe('package surface throttler responsibility discoverability', () => {
  it('documents throttler status types and operation responsibility in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishReadme = readFileSync(join(repoRoot, 'packages/throttler/README.md'), 'utf8');
    const koreanReadme = readFileSync(join(repoRoot, 'packages/throttler/README.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(markdown).toContain('@fluojs/throttler');
      expect(markdown).toContain('backing-store readiness');
      expect(markdown).toContain('ownership');
    }

    for (const markdown of [englishReadme, koreanReadme]) {
      expect(markdown).toContain('ThrottlerStatusAdapterInput');
      expect(markdown).toContain('ThrottlerPlatformStatusSnapshot');
      expect(markdown).toContain('ThrottlerOperationMode');
    }
  });
});

describe('package surface microservices transport discoverability', () => {
  it('documents Redis Pub/Sub and Redis Streams in both package surface and AI context locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(markdown).toContain('@fluojs/microservices');
      expect(markdown).toContain('Redis Pub/Sub');
      expect(markdown).toContain('Redis Streams');
    }
  });
});

describe('package surface CQRS responsibility discoverability', () => {
  it('documents CQRS buses, handler discovery, sagas, and event-bus delegation in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishArchitecture = readFileSync(join(repoRoot, 'docs/architecture/cqrs.md'), 'utf8');
    const koreanArchitecture = readFileSync(join(repoRoot, 'docs/architecture/cqrs.ko.md'), 'utf8');
    const englishReadme = readFileSync(join(repoRoot, 'packages/cqrs/README.md'), 'utf8');
    const koreanReadme = readFileSync(join(repoRoot, 'packages/cqrs/README.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(markdown).toContain('@fluojs/cqrs');
      expect(markdown).toContain('handler discovery');
      expect(markdown).toContain('saga');
      expect(markdown).toContain('event-bus');
    }

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface, englishArchitecture, koreanArchitecture, englishReadme, koreanReadme]) {
      expect(markdown).toContain('CqrsDispatchContext');
      expect(markdown).toContain('opaque');
      expect(markdown).toContain('CqrsModule.forRoot(...)');
    }

    for (const markdown of [englishArchitecture, koreanArchitecture]) {
      expect(markdown).not.toContain('AsyncLocalStorage');
      expect(markdown).toContain('branded');
    }
  });
});

describe('package surface event-bus responsibility discoverability', () => {
  it('documents event-bus visibility defaults and Redis transport subpath in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishReadme = readFileSync(join(repoRoot, 'packages/event-bus/README.md'), 'utf8');
    const koreanReadme = readFileSync(join(repoRoot, 'packages/event-bus/README.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface, englishReadme, koreanReadme]) {
      expect(markdown).toContain('@fluojs/event-bus');
      expect(markdown).toContain('EventBusModule.forRoot({ global?');
      expect(markdown).toContain('@fluojs/event-bus/redis');
    }

    for (const markdown of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(markdown).toContain('global: false');
    }
  });
});

describe('runtime subpath surface discoverability', () => {
  it('distinguishes application-facing helpers from internal package-integration seams in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(markdown).toContain('@fluojs/runtime/node');
      expect(markdown).toContain('@fluojs/runtime/web');
      expect(markdown).toContain('@fluojs/runtime/internal*');
      expect(markdown).toContain('package-integration seam');
    }
  });
});

describe('Vite decorator tooling discoverability', () => {
  it('keeps Vite app and Vitest test transform boundaries discoverable in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const englishChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const englishToolchainMatrix = readFileSync(join(repoRoot, 'docs/reference/toolchain-contract-matrix.md'), 'utf8');
    const englishViteReadme = readFileSync(join(repoRoot, 'packages/vite/README.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const koreanChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');
    const koreanToolchainMatrix = readFileSync(join(repoRoot, 'docs/reference/toolchain-contract-matrix.ko.md'), 'utf8');
    const koreanViteReadme = readFileSync(join(repoRoot, 'packages/vite/README.ko.md'), 'utf8');
    const englishDocs = [
      englishContext,
      englishChooser,
      englishToolchainMatrix,
      readFileSync(join(repoRoot, 'docs/getting-started/quick-start.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8'),
      englishViteReadme,
    ];
    const koreanDocs = [
      koreanContext,
      koreanChooser,
      koreanToolchainMatrix,
      readFileSync(join(repoRoot, 'docs/getting-started/quick-start.ko.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8'),
      koreanViteReadme,
    ];

    for (const markdown of [...englishDocs, ...koreanDocs]) {
      expect(markdown).toContain('@fluojs/vite');
      expect(markdown).toContain('@fluojs/testing/vitest');
      expect(markdown).toContain('vite.config.ts');
      expect(markdown).toContain('vitest.config.ts');
    }

    for (const markdown of [
      englishContext,
      englishChooser,
      englishToolchainMatrix,
      englishViteReadme,
      koreanContext,
      koreanChooser,
      koreanToolchainMatrix,
      koreanViteReadme,
    ]) {
      expect(markdown).toContain('@babel/preset-typescript');
    }

    for (const markdown of [englishContext, englishChooser, englishToolchainMatrix, englishViteReadme]) {
      expect(markdown).toMatch(/lazy|lazily/u);
    }
    for (const markdown of [koreanContext, koreanChooser, koreanToolchainMatrix, koreanViteReadme]) {
      expect(markdown).toContain('lazy');
    }
  });
});

describe('event-bus transport discoverability', () => {
  it('documents event-bus transport fan-out and drain guidance from the AI context and package references in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const koreanChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(markdown).toContain('@fluojs/event-bus');
      expect(markdown).toContain('Redis Pub/Sub');
      expect(markdown).toContain('inherited event channel fan-out');
      expect(markdown).toContain('inbound transport callback');
    }

    for (const markdown of [englishContext, koreanContext, englishChooser, koreanChooser]) {
      expect(markdown).toContain('@fluojs/event-bus/redis');
      expect(markdown).toContain('@fluojs/redis');
      expect(markdown).toContain('cross-process');
    }
  });
});

describe('i18n subpath discoverability', () => {
  it('documents governed @fluojs/i18n subpaths from the AI context and package references in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const koreanChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface, englishChooser, koreanChooser]) {
      expect(markdown).toContain('@fluojs/i18n/icu');
      expect(markdown).toContain('@fluojs/i18n/http');
      expect(markdown).toContain('@fluojs/i18n/adapters');
      expect(markdown).toContain('@fluojs/i18n/validation');
      expect(markdown).toContain('@fluojs/i18n/loaders/fs');
      expect(markdown).toContain('@fluojs/i18n/loaders/remote');
      expect(markdown).toContain('@fluojs/i18n/typegen');
    }
  });

  it('links the i18n ecosystem bridge decision record from the AI context in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');

    expect(englishContext).toContain('docs/reference/i18n-ecosystem-bridges.md');
    expect(englishContext).toContain('i18n ecosystem bridge compatibility');
    expect(koreanContext).toContain('docs/reference/i18n-ecosystem-bridges.ko.md');
    expect(koreanContext).toContain('i18n ecosystem bridge compatibility');
  });

  it('keeps the i18n root runtime boundary and provider visibility contract discoverable', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishReadme = readFileSync(join(repoRoot, 'packages/i18n/README.md'), 'utf8');
    const koreanReadme = readFileSync(join(repoRoot, 'packages/i18n/README.ko.md'), 'utf8');

    expect(englishReadme).toContain('does not declare a Node.js engine floor');
    expect(englishReadme).toContain('global provider by default');
    expect(englishSurface).toContain('does not declare a Node.js engine floor');
    expect(englishSurface).toContain('exposes `I18nService` globally by default');
    expect(englishContext).toContain('has no Node.js engine floor');
    expect(englishContext).toContain('registers `I18nService` globally by default');

    expect(koreanReadme).toContain('Node.js engine floor를 선언하지 않으며');
    expect(koreanReadme).toContain('기본적으로 `I18nService`를 global provider로 export');
    expect(koreanSurface).toContain('Node.js engine floor를 선언하지 않는');
    expect(koreanSurface).toContain('기본적으로 `I18nService`를 global로 노출');
    expect(koreanContext).toContain('Node.js engine floor가 없으며');
    expect(koreanContext).toContain('`I18nService`를 기본 global provider로 등록');
  });
});

describe('serialization package discoverability', () => {
  it('documents response serialization responsibility from the AI context and package references in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const koreanChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface, englishChooser, koreanChooser]) {
      expect(markdown).toContain('@fluojs/serialization');
      expect(markdown).toContain('response');
      expect(markdown).toContain('DTO');
    }
  });
});

describe('Terminus chooser discoverability', () => {
  it('documents Terminus subpaths and timeout guardrails from the AI context and package chooser in both locales', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const koreanChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');

    for (const markdown of [englishContext, koreanContext, englishChooser, koreanChooser]) {
      expect(markdown).toContain('@fluojs/terminus/node');
      expect(markdown).toContain('@fluojs/terminus/redis');
      expect(markdown).toContain('execution.indicatorTimeoutMs');
    }
  });
});

describe('Queue lifecycle discoverability', () => {
  function extractNodeEngineRange(manifest: string): string {
    const range = /"engines"\s*:\s*\{\s*"node"\s*:\s*"([^"]+)"/u.exec(manifest)?.[1];
    if (range === undefined) {
      throw new TypeError('Expected the Queue package manifest to declare engines.node.');
    }

    return range;
  }

  function extractMarkdownLine(markdown: string, marker: string): string {
    const line = markdown.split('\n').find((candidate) => candidate.includes(marker));
    if (line === undefined) {
      throw new TypeError(`Expected Queue documentation line containing "${marker}".`);
    }

    return line;
  }

  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/queue/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/queue/README.ko.md'), 'utf8');
  const englishChapter = readFileSync(join(repoRoot, 'book/intermediate/ch11-queue.md'), 'utf8');
  const koreanChapter = readFileSync(join(repoRoot, 'book/intermediate/ch11-queue.ko.md'), 'utf8');
  const packageManifest = readFileSync(join(repoRoot, 'packages/queue/package.json'), 'utf8');

  it('keeps the package manifest Node.js runtime floor discoverable across governed Queue docs', () => {
    const nodeEngineRange = extractNodeEngineRange(packageManifest);

    for (const queueRuntimeEntry of [
      extractMarkdownLine(englishContext, 'Queue lifecycle discoverability'),
      extractMarkdownLine(koreanContext, 'Queue lifecycle discoverability'),
      extractMarkdownLine(englishSurface, '- **`@fluojs/queue`**:'),
      extractMarkdownLine(koreanSurface, '- **`@fluojs/queue`**:'),
      extractMarkdownLine(englishReadme, '`@fluojs/queue` requires Node.js'),
      extractMarkdownLine(koreanReadme, '`@fluojs/queue`는 package manifest'),
      extractMarkdownLine(englishChapter, '`@fluojs/queue` is a Node.js'),
      extractMarkdownLine(koreanChapter, '`@fluojs/queue`는 `engines.node'),
    ]) {
      expect(queueRuntimeEntry).toContain('Node.js');
      expect(queueRuntimeEntry).toContain(nodeEngineRange);
    }
  });

  it('keeps bootstrap-ready and bounded-shutdown lifecycle docs discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('bootstrap-ready');
      expect(content).toContain('workerShutdownTimeoutMs');
    }
  });
});

describe('Notifications discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/notifications/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/notifications/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const englishChapter = readFileSync(join(repoRoot, 'book/intermediate/ch15-notifications.md'), 'utf8');
  const koreanChapter = readFileSync(join(repoRoot, 'book/intermediate/ch15-notifications.ko.md'), 'utf8');
  const englishMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
  const koreanMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');

  it('keeps async registration, batch dispatch, queue, lifecycle, and status APIs discoverable across governed docs', () => {
    for (const content of [englishSurface, koreanSurface, englishContext, koreanContext, englishReadme, koreanReadme, englishChapter, koreanChapter]) {
      expect(content).toContain('NotificationsModule.forRoot');
      expect(content).toContain('forRootAsync');
      expect(content).toContain('global: false');
      expect(content).toContain('dispatchMany(...)');
      expect(content).toContain('createNotificationsPlatformStatusSnapshot(...)');
    }

    for (const content of [englishSurface, koreanSurface, englishContext, koreanContext, englishChapter, koreanChapter]) {
      expect(content).toContain('NotificationsService.createPlatformStatusSnapshot()');
      expect(content).toMatch(/queue.*event-bus|event-bus.*queue/u);
    }

    for (const content of [englishChapter, koreanChapter]) {
      expect(content).toContain('NotificationDispatchBatchResult');
      expect(content).toContain('NotificationQueueNotConfiguredError');
    }
  });

  it('keeps explicit channel registration and externally managed resource boundaries discoverable for NestJS migrations', () => {
    for (const content of [englishContext, englishReadme, englishChapter, englishMigration]) {
      expect(content).toContain('NotificationChannel');
      expect(content).toContain('channels');
      expect(content).toContain('global: false');
      expect(content).toMatch(/provider[- ]discovery|provider metadata|decorator[- ]metadata|emitted metadata|emitDecoratorMetadata/u);
      expect(content).toMatch(/application-owned|externally managed|outside the foundation package/u);
    }

    for (const content of [koreanContext, koreanReadme, koreanChapter, koreanMigration]) {
      expect(content).toContain('NotificationChannel');
      expect(content).toContain('channels');
      expect(content).toContain('global: false');
      expect(content).toContain('metadata');
      expect(content).toMatch(/애플리케이션 소유|foundation 패키지 밖|externally managed/u);
    }
  });
});

describe('Cron scheduling discoverability', () => {
  function extractMarkdownSection(markdown: string, heading: string): string {
    const sectionStart = markdown.indexOf(`${heading}\n`);
    const headingLevel = /^#+/u.exec(heading)?.[0].length;
    if (sectionStart === -1 || headingLevel === undefined) {
      throw new TypeError(`Expected Cron documentation section "${heading}".`);
    }

    const sectionBodyStart = sectionStart + heading.length + 1;
    const remainingMarkdown = markdown.slice(sectionBodyStart);
    const nextHeading = new RegExp(`^#{1,${headingLevel}}\\s`, 'mu').exec(remainingMarkdown);
    const sectionBodyEnd = sectionBodyStart + (nextHeading?.index ?? remainingMarkdown.length);

    return markdown.slice(sectionStart, sectionBodyEnd);
  }

  function extractMarkdownLines(markdown: string, markers: readonly string[]): string {
    return markers.map((marker) => {
      const line = markdown.split('\n').find((candidate) => candidate.includes(marker));
      if (line === undefined) {
        throw new TypeError(`Expected Cron documentation line containing "${marker}".`);
      }

      return line;
    }).join('\n');
  }

  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishPackageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanPackageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/cron/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/cron/README.ko.md'), 'utf8');
  const englishMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
  const koreanMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');
  const englishChapter = readFileSync(join(repoRoot, 'book/intermediate/ch12-cron.md'), 'utf8');
  const koreanChapter = readFileSync(join(repoRoot, 'book/intermediate/ch12-cron.ko.md'), 'utf8');

  it('keeps cron lifecycle, public API, and package-surface guidance discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext]) {
      expect(content).toContain('packages/cron/README');
      expect(content).toContain('docs/reference/package-surface');
      expect(content).toContain('book/intermediate/ch12-cron');
      expect(content).toContain('dynamic-start lifecycle guarantee');
    }

    for (const content of [englishPackageSurface, koreanPackageSurface, englishReadme, koreanReadme]) {
      expect(content).toContain('@fluojs/cron');
      expect(content).toContain('distributed');
      expect(content).toContain('status snapshot');
    }

    for (const content of [englishChapter, koreanChapter]) {
      expect(content).toMatch(/five|다섯/);
      expect(content).toMatch(/six|여섯/);
      expect(content).toContain('dynamic');
    }
  });

  it('keeps the Cron Redis peer boundary discoverable across context, references, package docs, and book guidance', () => {
    for (const content of [englishContext, koreanContext]) {
      expect(content).toContain('distributed-only');
      expect(content).toContain('distributed.enabled');
    }

    for (const content of [englishPackageSurface, koreanPackageSurface, englishReadme, koreanReadme]) {
      expect(content).toContain('Redis peer');
      expect(content).toContain('distributed.enabled');
    }

    for (const content of [englishChapter, koreanChapter]) {
      expect(content).toContain('Redis peer');
      expect(content).toContain('distributed-lock');
    }
  });

  it('keeps Cron NestJS option and overlap migration boundaries discoverable across bilingual surfaces', () => {
    const englishCronRegions = [
      extractMarkdownSection(englishContext, '## Cron Migration Option Boundary'),
      [
        extractMarkdownSection(englishReadme, '### Migrating NestJS Cron Options'),
        extractMarkdownSection(englishReadme, '### Distributed Locking'),
      ].join('\n'),
      extractMarkdownLines(englishMigration, ['| `@nestjs/schedule`', '- NestJS cron options']),
      [
        extractMarkdownSection(englishChapter, '### 12.3.2 Migrating NestJS cron options'),
        extractMarkdownSection(englishChapter, '## 12.4 Distributed locking across multiple instances'),
      ].join('\n'),
    ];
    const koreanCronRegions = [
      extractMarkdownSection(koreanContext, '## Cron Migration Option Boundary'),
      [
        extractMarkdownSection(koreanReadme, '### NestJS Cron 옵션 마이그레이션'),
        extractMarkdownSection(koreanReadme, '### 분산 락 사용하기'),
      ].join('\n'),
      extractMarkdownLines(koreanMigration, ['| `@nestjs/schedule`', '- NestJS cron option']),
      [
        extractMarkdownSection(koreanChapter, '### 12.3.2 Migrating NestJS cron options'),
        extractMarkdownSection(koreanChapter, '## 12.4 Distributed locking across multiple instances'),
      ].join('\n'),
    ];

    for (const cronRegion of englishCronRegions) {
      expect(cronRegion).toContain('timeZone');
      expect(cronRegion).toContain('timezone');
      expect(cronRegion).toContain('waitForCompletion');
      expect(cronRegion).toMatch(/does not expose|has no .*option|no direct fluo option/u);
      expect(cronRegion).toMatch(/skip(?:s|ped)?[^.]*?(?:not queued|rather than queue(?:d|ing)|instead of queueing)/u);
      expect(cronRegion).toMatch(/application-owned queue|application-owned.*worker/u);
      expect(cronRegion).toContain('Redis');
      expect(cronRegion).toMatch(/distributed lock/u);
    }

    for (const cronRegion of koreanCronRegions) {
      expect(cronRegion).toContain('timeZone');
      expect(cronRegion).toContain('timezone');
      expect(cronRegion).toContain('waitForCompletion');
      expect(cronRegion).toMatch(/옵션이 없|option이 없|옵션을 .*노출하지 않/u);
      expect(cronRegion).toMatch(/(?:queue하지 않고|queue되지 않고).*건너/u);
      expect(cronRegion).toMatch(/application-owned queue|application-owned.*worker/u);
      expect(cronRegion).toContain('Redis');
      expect(cronRegion).toMatch(/distributed lock/u);
    }
  });
});

describe('HTTP adapter raw-body portability discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/testing/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/testing/README.ko.md'), 'utf8');

  it('keeps byte-sensitive raw-body portability docs discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('assertPreservesExactRawBodyBytesForByteSensitivePayloads');
      expect(content).toContain('byte-sensitive');
      expect(content).toContain('rawBody');
    }
  });
});

describe('Testing request-scope and surface discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/testing/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/testing/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

  it('keeps request-scoped DI isolation and public helper subpaths discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('@fluojs/testing/http');
      expect(content).toContain('app.request(...).send()');
      expect(content).toContain('request-scoped');
      expect(content).toContain('DeepMocked<T>');
    }

    for (const content of [englishSurface, koreanSurface]) {
      expect(content).toContain('@fluojs/testing/http');
      expect(content).toContain('request-scoped DI isolation');
    }
  });
});

describe('Socket.IO runtime limitation discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/socket.io/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/socket.io/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

  it('keeps runtime limits, guard request typing, and shutdown retry docs discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('@fluojs/socket.io');
      expect(content).toContain('SocketIoHandshakeRequest');
      expect(content).toContain('force-disconnect');
    }

    for (const content of [englishSurface, koreanSurface]) {
      expect(content).toContain('@fluojs/socket.io');
      expect(content).toContain('Bun');
      expect(content).toMatch(/runtime limit|runtime limitation|런타임 제한/);
    }
  });
});

describe('WebSockets runtime subpath discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/websockets/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/websockets/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const englishChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
  const koreanChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');

  it('keeps fetch-style authoring primitives discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('@fluojs/websockets/bun');
      expect(content).toContain('@fluojs/websockets/deno');
      expect(content).toContain('@fluojs/websockets/cloudflare-workers');
      expect(content).toMatch(/metadata authoring primitive|metadata helper|Metadata helper/);
    }

    for (const content of [englishSurface, koreanSurface, englishChooser, koreanChooser]) {
      expect(content).toContain('@fluojs/websockets/node');
      expect(content).toContain('@fluojs/websockets/cloudflare-workers');
      expect(content).toMatch(/shared .*metadata|공유 .*metadata/);
    }
  });
});

describe('Passport auth discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/passport/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/passport/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

  it('keeps public helper and readiness docs discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('@fluojs/passport');
      expect(content).toContain('PassportModule.forRoot');
      expect(content).toContain('AuthGuard');
      expect(content).toContain('createPassportPlatformStatusSnapshot');
    }

    for (const content of [englishSurface, koreanSurface]) {
      expect(content).toContain('@fluojs/passport');
      expect(content).toContain('PassportModule');
      expect(content).toMatch(/authentication guards|인증 가드/);
      expect(content).toContain('platform status/diagnostic');
    }
  });

  it('keeps bridge and cookie compatibility provider bundles discoverable', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme, englishSurface, koreanSurface]) {
      expect(content).toContain('createPassportJsStrategyBridge(...)');
      expect(content).toContain('createCookieAuthPreset(...)');
      expect(content).toContain('provider bundle');
    }

    for (const content of [englishReadme, koreanReadme]) {
      expect(content).toContain('PassportModule.forRoot');
      expect(content).toContain('CookieAuthModule.forRoot');
      expect(content).toContain('AuthGuard');
      expect(content).toMatch(/manual-composition|manual provider|manual provider composition/);
    }
  });
});

describe('Slack delivery discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/slack/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/slack/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const englishBook = readFileSync(join(repoRoot, 'book/intermediate/ch17-slack-discord.md'), 'utf8');
  const koreanBook = readFileSync(join(repoRoot, 'book/intermediate/ch17-slack-discord.ko.md'), 'utf8');
  const englishMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
  const koreanMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');

  it('keeps helper, abort, lifecycle, status, verification, and template guidance discoverable', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme, englishSurface, koreanSurface]) {
      expect(content).toContain('@fluojs/slack');
      expect(content).toContain('createSlackProviders(...)');
      expect(content).toContain('verifyOnModuleInit');
      expect(content).toContain('SlackTemplateRenderer');
    }

    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('SlackModule.forRoot');
      expect(content).toContain('abort');
      expect(content).toContain('lifecycle');
      expect(content).toMatch(/status|Status/);
    }

    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme, englishBook, koreanBook]) {
      expect(content).toContain('SlackModule.forRoot');
      expect(content).toContain('verifyOnModuleInit');
      expect(content).toContain('SlackTemplateRenderer');
      expect(content).toContain('template');
      expect(content).toContain('payload');
    }
  });

  it('keeps singleton and global module migration boundaries discoverable', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme, englishSurface, koreanSurface]) {
      expect(content).toContain('SLACK');
      expect(content).toContain('SLACK_CHANNEL');
      expect(content).toContain('global: false');
      expect(content).toContain('singleton');
    }

    for (const content of [englishReadme, koreanReadme, englishBook, koreanBook, englishMigration, koreanMigration]) {
      expect(content).toContain('global?: boolean');
      expect(content).toContain('isGlobal');
      expect(content).toContain('multi-client registry');
    }
  });
});

describe('Discord delivery discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/discord/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/discord/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const englishBook = readFileSync(join(repoRoot, 'book/intermediate/ch17-slack-discord.md'), 'utf8');
  const koreanBook = readFileSync(join(repoRoot, 'book/intermediate/ch17-slack-discord.ko.md'), 'utf8');
  const englishMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
  const koreanMigration = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');

  it('keeps service status, standalone usage, and hub paths discoverable', () => {
    for (const content of [englishReadme, koreanReadme]) {
      expect(content).toContain('DiscordService.createPlatformStatusSnapshot()');
      expect(content).toContain('createDiscordPlatformStatusSnapshot(...)');
      expect(content).toContain('transport');
      expect(content).toContain('notifications');
    }

    for (const content of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(content).toContain('@fluojs/discord');
      expect(content).toContain('DiscordService.createPlatformStatusSnapshot()');
      expect(content).toContain('createDiscordPlatformStatusSnapshot(...)');
    }

    for (const content of [englishContext, koreanContext]) {
      expect(content).toContain('packages/discord/README');
      expect(content).toContain('docs/reference/package-surface');
      expect(content).toContain('book/intermediate/ch17-slack-discord');
    }

    for (const content of [englishBook, koreanBook]) {
      expect(content).toContain('DiscordService');
      expect(content).toContain('DiscordService.createPlatformStatusSnapshot()');
      expect(content).toContain('notifications.discord.offline');
      expect(content).toContain('await this.discord.send');
    }
  });

  it('keeps async, global, and internal-provider migration boundaries discoverable', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme, englishSurface, koreanSurface]) {
      expect(content).toContain('DISCORD');
      expect(content).toContain('DISCORD_CHANNEL');
      expect(content).toContain('global: false');
      expect(content).toContain('private');
    }

    for (const content of [englishReadme, koreanReadme, englishBook, koreanBook, englishMigration, koreanMigration]) {
      expect(content).toContain('global?: boolean');
      expect(content).toContain('isGlobal');
      expect(content).toContain('useClass');
      expect(content).toContain('useExisting');
      expect(content).toContain('createDiscordProviders(...)');
      expect(content).toContain('DISCORD_OPTIONS');
      expect(content).toContain('NormalizedDiscordModuleOptions');
    }
  });
});

describe('CLI inspect artifact discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');

  it('keeps inspect timing and default JSON output docs discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext]) {
      expect(content).toContain('docs/reference/toolchain-contract-matrix');
      expect(content).toContain('packages/cli/README');
      expect(content).toContain('--timing');
      expect(content).toContain('JSON');
      expect(content).toContain('@fluojs/studio');
    }
  });
});

describe('Studio public docs and migration expectations', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/studio/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/studio/README.ko.md'), 'utf8');
  const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

  it('keeps Studio sidecar, fallback, dependency, and exported type docs discoverable', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme, englishSurface, koreanSurface]) {
      expect(content).toContain('@fluojs/studio');
      expect(content).toContain('Node dev-runner');
      expect(content).toContain('Bun');
      expect(content).toContain('Deno');
      expect(content).toContain('Cloudflare Workers');
      expect(content).toContain('StudioLiveEvent');
      expect(content).toContain('StudioLiveSnapshot');
      expect(content).toContain('StudioRequestTrace');
    }

    for (const content of [englishReadme, koreanReadme]) {
      expect(content).toContain('pnpm add -D @fluojs/studio');
      expect(content).toContain('pnpm add @fluojs/studio');
      expect(content).toContain('Root type export');
    }

    for (const content of [englishSurface, koreanSurface]) {
      expect(content).toContain('parseStudioPayload(...)');
      expect(content).toContain('applyFilters(...)');
      expect(content).toContain('renderMermaid(snapshot)');
    }
  });
});
