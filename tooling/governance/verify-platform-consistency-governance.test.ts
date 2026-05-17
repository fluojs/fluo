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

  it('accepts mongoose package-surface guidance when context discoverability and governance tests change together', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() =>
      enforceContractCompanionUpdates([
        'docs/reference/package-surface.md',
        'docs/reference/package-surface.ko.md',
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'packages/mongoose/src/public-api.test.ts',
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

  it('treats release governance publish-surface edits as contract-governing updates', async () => {
    const { enforceContractCompanionUpdates } = await loadGovernanceInternals();

    expect(() => enforceContractCompanionUpdates(['docs/contracts/release-governance.md'])).toThrowError(
      /docs\/CONTEXT\.md and docs\/CONTEXT\.ko\.md/,
    );
  });
});

describe('repository governance contracts', () => {
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
    expect(releaseWorkflow).toContain('NPM_TOKEN: ${{ secrets.NPM_TOKEN }}');
    expect(releaseWorkflow).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
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

    for (const markdown of [englishContext, koreanContext, englishSurface, koreanSurface]) {
      expect(markdown).toContain('@fluojs/cqrs');
      expect(markdown).toContain('handler discovery');
      expect(markdown).toContain('saga');
      expect(markdown).toContain('event-bus');
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
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/queue/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/queue/README.ko.md'), 'utf8');

  it('keeps bootstrap-ready and bounded-shutdown lifecycle docs discoverable from the context hub', () => {
    for (const content of [englishContext, koreanContext, englishReadme, koreanReadme]) {
      expect(content).toContain('bootstrap-ready');
      expect(content).toContain('workerShutdownTimeoutMs');
    }
  });
});

describe('Cron scheduling discoverability', () => {
  const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const englishPackageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const koreanPackageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const englishReadme = readFileSync(join(repoRoot, 'packages/cron/README.md'), 'utf8');
  const koreanReadme = readFileSync(join(repoRoot, 'packages/cron/README.ko.md'), 'utf8');
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
