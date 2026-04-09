import { describe, expect, it } from 'vitest';

import {
  collectDirectProcessEnvViolations,
  enforceNoDirectProcessEnvInOrdinaryPackageSource,
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

describe('officialTransportDocsPackages', () => {
  it('includes platform-socket.io for docs-hub transport discoverability enforcement', async () => {
    const governanceModule = (await import('./verify-platform-consistency-governance.mjs')) as unknown as {
      getOfficialTransportDocsPackages: () => string[];
    };

    expect(governanceModule.getOfficialTransportDocsPackages()).toContain('@konekti/socket.io');
  });
});

describe('parsePackageNamesFromFamilyTable', () => {
  it('collects all public package names from the family table', () => {
    const markdown = [
      '## public package families',
      '',
      '| family | description | packages |',
      '| --- | --- | --- |',
      '| **HTTP** | Web API execution and routing. | `@konekti/http`, `@konekti/graphql` |',
      '| **Auth** | Authentication and authorization. | `@konekti/jwt`, `@konekti/passport` |',
      '',
      '## next section',
    ].join('\n');

    expect(parsePackageNamesFromFamilyTable(markdown, 'public package families')).toEqual([
      '@konekti/graphql',
      '@konekti/http',
      '@konekti/jwt',
      '@konekti/passport',
    ]);
  });

  it('stops collecting once the next section begins', () => {
    const markdown = [
      '## public package families',
      '',
      '| family | description | packages |',
      '| --- | --- | --- |',
      '| **Patterns** | Messaging and architecture. | `@konekti/notifications`, `@konekti/email` |',
      '',
      '## package responsibilities',
      '- `@konekti/email/node`: Node-only subpath',
    ].join('\n');

    expect(parsePackageNamesFromFamilyTable(markdown, 'public package families')).toEqual([
      '@konekti/email',
      '@konekti/notifications',
    ]);
  });
});
