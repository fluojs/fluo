import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BOOTSTRAP_SCHEMA } from './resolver.js';
import { scaffoldBootstrapApp } from './scaffold.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function readDirectorySnapshot(rootDirectory: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const pending = [rootDirectory];

  while (pending.length > 0) {
    const currentDirectory = pending.pop();

    if (!currentDirectory) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory)) {
      const entryPath = join(currentDirectory, entry);
      const entryStat = statSync(entryPath);

      if (entryStat.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      snapshot[relative(rootDirectory, entryPath)] = readFileSync(entryPath, 'utf8');
    }
  }

  return snapshot;
}

function readWorkspaceReactVersion(): string {
  const packageJson: unknown = JSON.parse(
    readFileSync(new URL('../../../react/package.json', import.meta.url), 'utf8'),
  );

  if (
    typeof packageJson !== 'object'
    || packageJson === null
    || !('version' in packageJson)
    || typeof packageJson.version !== 'string'
  ) {
    throw new Error('Expected packages/react/package.json to declare a string version.');
  }

  return packageJson.version;
}

describe('React SSR + Vite scaffold', () => {
  it('generates the HTTP-first starter contract when the named starter is selected', async () => {
    // Given
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-react-vite-'));
    temporaryDirectories.push(targetDirectory);
    const workspaceReactVersion = readWorkspaceReactVersion();

    // When
    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'react-app',
      skipInstall: true,
      starter: 'react-vite-ssr',
      targetDirectory,
    });

    // Then
    const snapshot = readDirectorySnapshot(targetDirectory);
    const packageJson: unknown = JSON.parse(snapshot['package.json'] ?? '{}');

    expect(packageJson).toEqual(expect.objectContaining({
      dependencies: expect.objectContaining({
        // This deterministically proves the emitted range resolves the workspace React release version.
        // A real registry install remains a release-time manual smoke because the local sandbox uses tarballs.
        '@fluojs/react': `^${workspaceReactVersion}`,
        react: '^19.2.6',
        'react-dom': '^19.2.6',
      }),
      devDependencies: expect.objectContaining({
        '@playwright/test': '^1.51.1',
        '@types/react': '^19.2.14',
        '@types/react-dom': '^19.2.3',
        'happy-dom': '^20.9.0',
      }),
      scripts: expect.objectContaining({
        build: 'vite build --config vite.client.config.ts && vite build --config vite.server.config.ts',
        dev: 'vite build --config vite.client.config.ts && vite build --config vite.server.config.ts && node dist/server/main.js',
        start: 'node dist/server/main.js',
        test: 'vitest run',
        'test:browser': 'playwright test --config playwright.config.ts',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      }),
    }));
    expect(Object.keys(snapshot).sort()).toEqual([
      '.env',
      '.gitignore',
      'README.md',
      'babel.config.cjs',
      'package.json',
      'playwright.config.ts',
      'src/app.test.ts',
      'src/app.tsx',
      'src/entry-client.tsx',
      'src/entry-server.tsx',
      'src/load-manifest.test.ts',
      'src/load-manifest.ts',
      'src/main.ts',
      'src/page.tsx',
      'src/react-app.test.tsx',
      'src/react-app.tsx',
      'src/styles.css',
      'src/styles.d.ts',
      'tests/production-hydration.spec.ts',
      'tsconfig.json',
      'vite.client.config.ts',
      'vite.server.config.ts',
      'vitest.config.ts',
    ]);
    expect(snapshot['src/app.tsx']).toContain("@Router('/products')");
    expect(snapshot['src/app.tsx']).toContain("@Path('/:sku')");
    expect(snapshot['src/app.tsx']).toContain('return <ProductPage />;');
    expect(snapshot['src/page.tsx']).toContain('return (');
    expect(snapshot['src/main.ts']).toContain("loadReactViteManifest(new URL('../client/.vite/manifest.json', import.meta.url))");
    expect(snapshot['src/main.ts']).toContain('createReactPageRenderer(manifest)');
    expect(snapshot['src/entry-client.tsx']).toContain('hydrateRoot(');
    expect(snapshot['src/entry-server.tsx']).toContain('const renderPage: ReactPageRenderer');
    expect(snapshot['src/entry-server.tsx']).toContain('createReactServerEntry(');
    expect(snapshot['src/react-app.tsx']).toContain('ReactClientRouterProvider');
    expect(snapshot['src/page.tsx']).toContain("<Link href='/products/sku-84?preview=false'>");
    expect(snapshot['src/page.tsx']).toContain("router.push('/products/sku-126?preview=true')");
    expect(snapshot['src/app.test.ts']).toContain("expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8')");
    expect(snapshot['src/load-manifest.test.ts']).toContain("expect(error.code).toBe('react-starter-manifest-missing')");
    expect(snapshot['src/app.test.ts']).toContain("expect(error.message).toContain('vite.client.config.ts')");
    expect(snapshot['src/react-app.test.tsx']).toContain("expect(consoleError).not.toHaveBeenCalled()");
    expect(snapshot['src/react-app.test.tsx']).toContain('reportReactHydrationMismatch(mismatch)');
    expect(snapshot['src/react-app.test.tsx']).toContain("expect.stringContaining('vite.client.config.ts')");
    expect(snapshot['tests/production-hydration.spec.ts']).toContain('expect(browserDiagnostics).toEqual([])');
    expect(snapshot['vite.client.config.ts']).toContain("manifest: true");
    expect(snapshot['vite.server.config.ts']).toContain("ssr: 'src/main.ts'");
    expect(snapshot).not.toHaveProperty('src/routes.generated.ts');
    expect(snapshot).not.toHaveProperty('src/app.ts');
    expect(snapshot).not.toHaveProperty('src/hydration.ts');
    expect(snapshot).not.toHaveProperty('src/hydration.test.tsx');
    expect(Object.values(snapshot).join('\n')).not.toContain('@fluojs/react/experimental/rsc');
    expect(snapshot['src/page.tsx']).not.toContain('prefetch');
    expect(snapshot['README.md']).toContain('This starter intentionally excludes RSC, Server Functions, file routing');
    expect(snapshot['README.md']).toContain('SPA document swapping, prefetch, and a data cache');
  });

  it.each([
    ['bun', 'bun install', 'bun run'],
    ['npm', 'npm install', 'npm run'],
    ['pnpm', 'pnpm install', 'pnpm'],
    ['yarn', 'yarn install', 'yarn'],
  ] as const)(
    'uses the selected %s package manager across generated lifecycle commands',
    async (packageManager, installCommand, runPrefix) => {
      // Given
      const targetDirectory = mkdtempSync(join(tmpdir(), `fluo-scaffold-react-vite-${packageManager}-`));
      temporaryDirectories.push(targetDirectory);
      const runCommand = (script: string) => `${runPrefix} ${script}`;

      // When
      await scaffoldBootstrapApp({
        ...DEFAULT_BOOTSTRAP_SCHEMA,
        packageManager,
        projectName: 'react-app',
        skipInstall: true,
        starter: 'react-vite-ssr',
        targetDirectory,
      });

      // Then
      const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
      const playwrightConfig = readFileSync(join(targetDirectory, 'playwright.config.ts'), 'utf8');
      const diagnostics = [
        readFileSync(join(targetDirectory, 'src', 'entry-server.tsx'), 'utf8'),
        readFileSync(join(targetDirectory, 'src', 'load-manifest.ts'), 'utf8'),
        readFileSync(join(targetDirectory, 'src', 'react-app.tsx'), 'utf8'),
      ].join('\n');

      expect(readme).toContain(`${installCommand}\n${runCommand('dev')}`);
      expect(readme).toContain([
        runCommand('typecheck'),
        runCommand('test'),
        runCommand('build'),
        runCommand('start'),
        runCommand('test:browser'),
      ].join('\n'));
      expect(playwrightConfig).toContain(JSON.stringify(runCommand('dev')));
      expect(playwrightConfig).toContain(JSON.stringify(runCommand('start')));
      expect(diagnostics).toContain('generated build script');
      expect(diagnostics).not.toContain('pnpm');
    },
  );
});
