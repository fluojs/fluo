import { readFileSync } from 'node:fs';
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

async function loadGovernanceInternals() {
  return (await import('./verify-platform-consistency-governance.mjs')) as unknown as {
    changedFilesFromGit: (runCommand?: RunCommand, env?: { GITHUB_BASE_REF?: string }) => string[];
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

  it('treats release governance publish-surface edits as contract-governing updates', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() => enforceContractCompanionUpdates(['docs/contracts/release-governance.md'])).toThrowError(
      /docs\/CONTEXT\.md and docs\/CONTEXT\.ko\.md/,
    );
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
