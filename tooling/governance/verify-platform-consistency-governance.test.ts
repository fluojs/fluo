import { describe, expect, it } from 'vitest';

import {
  collectDirectProcessEnvViolations,
  collectNodeGlobalBufferViolations,
  enforceNoDirectProcessEnvInOrdinaryPackageSource,
  enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices,
  isGovernedPackageSourcePath,
  parsePackageNamesFromFamilyTable,
} from './verify-platform-consistency-governance.mjs';

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
