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
        '@vitejs/plugin-react': '^6.1.1',
        '@types/react': '^19.2.14',
        '@types/react-dom': '^19.2.3',
        '@vitest/coverage-v8': '^4.1.11',
        'happy-dom': '^20.9.0',
        vite: '^8.2.2',
        vitest: '^4.1.11',
      }),
      scripts: expect.objectContaining({
        typegen: 'fluo typegen src/app.ts --export AppModule --options applicationOptions --tsconfig tsconfig.json --output src/generated/react-pages.ts',
        'typegen:check': 'fluo typegen src/app.ts --export AppModule --options applicationOptions --tsconfig tsconfig.json --output src/generated/react-pages.ts --check',
        'typegen:watch': 'fluo typegen src/app.ts --export AppModule --options applicationOptions --tsconfig tsconfig.json --output src/generated/react-pages.ts --watch',
        build: 'fluo typegen src/app.ts --export AppModule --options applicationOptions --tsconfig tsconfig.json --output src/generated/react-pages.ts --check && vite build --config vite.client.config.ts && vite build --config vite.server.config.ts',
        dev: 'fluo dev',
        start: 'node dist/server/main.js',
        test: 'vitest run',
        'test:browser': 'playwright test --config playwright.config.ts',
        typecheck: 'fluo typegen src/app.ts --export AppModule --options applicationOptions --tsconfig tsconfig.json --output src/generated/react-pages.ts --check && tsc -p tsconfig.json --noEmit',
      }),
    }));
    expect(Object.keys(snapshot).sort()).toEqual([
      '.env',
      '.gitignore',
      'README.md',
      'babel.config.cjs',
      'package.json',
      'playwright.config.ts',
      'public/favicon.svg',
      'src/app.test.ts',
      'src/app.ts',
      'src/catalog.ts',
      'src/entry-client-dev.ts',
      'src/entry-client.tsx',
      'src/entry-server.tsx',
      'src/load-manifest.test.ts',
      'src/load-manifest.ts',
      'src/main.ts',
      'src/page-products.tsx',
      'src/page-search.tsx',
      'src/page.tsx',
      'src/react-app.test.tsx',
      'src/react-app.tsx',
      'src/session-controls.tsx',
      'src/styles.css',
      'src/styles.d.ts',
      'tests/background-interactions.spec.ts',
      'tests/deployment-transition.spec.ts',
      'tests/form-control.ts',
      'tests/navigation-guard.spec.ts',
      'tests/production-hydration.spec.ts',
      'tests/session-transition.spec.ts',
      'tsconfig.json',
      'vite.client.config.ts',
      'vite.server.config.ts',
      'vitest.config.ts',
    ]);
    expect(snapshot['src/app.ts']).toContain("@Router('/products')");
    expect(snapshot['src/app.ts']).toContain("@Path('/:sku')");
    expect(snapshot['src/app.ts']).toContain("module: './page.tsx'");
    expect(snapshot['src/app.ts']).toContain("module: './page-search.tsx'");
    expect(snapshot['src/app.ts']).toContain('await options.loadPage');
    expect(snapshot['src/page.tsx']).toContain('return (');
    expect(snapshot['tests/navigation-guard.spec.ts']).toBe(readFileSync(
      new URL('./templates/react-vite-ssr/tests/navigation-guard.spec.ts.ejs', import.meta.url), 'utf8',
    ));
    expect(snapshot['src/main.ts']).toContain("process.env.FLUO_REACT_MANIFEST_URL ?? '../client/.vite/manifest.json'");
    expect(snapshot['src/main.ts']).toContain('navigationBuildId: selectedRenderer.buildId');
    expect(snapshot['src/main.ts']).toContain('createReactPageRenderer(manifest)');
    expect(snapshot['src/entry-client.tsx']).toContain('hydrateRoot(');
    expect(snapshot['src/entry-server.tsx']).toContain('const renderPage: ReactPageRenderer');
    expect(snapshot['src/entry-server.tsx']).toContain('createReactServerEntry(');
    expect(snapshot['src/react-app.tsx']).toContain('ReactClientRouterProvider');
    expect(snapshot['src/react-app.tsx']).toContain("href='/assets/favicon.svg'");
    expect(snapshot['public/favicon.svg']).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(snapshot['src/page.tsx']).toContain("reactPageRoutes['GET /search SearchPageRouter show'].link({ q: 'catalog' })");
    expect(snapshot['src/react-app.tsx']).toContain("reactPageRoutes['GET /products/:sku ProductPageRouter show'].push(router, { sku: 'sku-126' }, { preview: 'true' })");
    expect(snapshot['src/app.test.ts']).toContain("import { Test } from '@fluojs/testing';");
    expect(snapshot['src/app.test.ts']?.match(/Test\.createApp\(\{ rootModule: AppModule \}\)/g)).toHaveLength(6);
    expect(snapshot['src/app.test.ts']?.match(/defer\(\(\) => app\.close\(\)\);/g)).toHaveLength(6);
    expect(snapshot['src/app.test.ts']).toContain("expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8')");
    expect(snapshot['src/load-manifest.test.ts']).toContain("expect(error.code).toBe('react-starter-manifest-missing')");
    expect(snapshot['src/app.test.ts']).toContain("expect(error.code).toBe('react-starter-entry-incompatible')");
    expect(snapshot['src/react-app.test.tsx']).toContain("expect(consoleError).not.toHaveBeenCalled()");
    expect(snapshot['src/react-app.test.tsx']).toContain('reportReactHydrationMismatch(mismatch)');
    expect(snapshot['tests/production-hydration.spec.ts']).toContain('expect(browserDiagnostics).toEqual([])');
    expect(snapshot['vite.client.config.ts']).toContain("manifest: true");
    expect(snapshot['vite.client.config.ts']).toContain("name: 'fluo:client-manifest-server-entry'");
    expect(snapshot['babel.config.cjs']).toContain("parserOptions.plugins.push('jsx')");
    expect(snapshot['vite.server.config.ts']).toContain("ssr: 'src/main.ts'");
    expect(snapshot['vite.client.config.ts']).toContain('rolldownOptions:');
    expect(snapshot['vite.server.config.ts']).toContain('rolldownOptions:');
    expect(snapshot['vite.server.config.ts']).toContain('plugins: [');
    expect(snapshot['vite.server.config.ts']).toContain(
      "fluoDecoratorsPlugin({ babelConfigFile: fileURLToPath(new URL('./babel.config.cjs', import.meta.url)) })",
    );
    expect(snapshot['vitest.config.ts']).toContain("transformBoundary: 'test'");
    expect(snapshot['vitest.config.ts']).toContain("babelConfigFile: fileURLToPath(new URL('./babel.config.cjs', import.meta.url))");
    expect(snapshot['vitest.config.ts']).toContain("setupFiles: ['@fluojs/core/metadata-preload']");
    expect(snapshot['src/main.ts']).toMatch(/^import '@fluojs\/core\/metadata-preload';/u);
    for (const config of ['vite.client.config.ts', 'vite.server.config.ts', 'vitest.config.ts']) {
      expect(snapshot[config]).not.toMatch(/\b(?:rollupOptions|oxc|esbuild)\s*:/u);
    }
    expect(snapshot).not.toHaveProperty('src/routes.generated.ts');
    expect(snapshot).not.toHaveProperty('src/app.tsx');
    expect(snapshot).not.toHaveProperty('src/hydration.ts');
    expect(snapshot).not.toHaveProperty('src/hydration.test.tsx');
    expect(Object.values(snapshot).join('\n')).not.toContain('@fluojs/react/experimental/rsc');
    expect(snapshot['src/page.tsx']).not.toContain('prefetch');
  });

  it.each([
    ['bun', 'bun run'],
    ['npm', 'npm run'],
    ['pnpm', 'pnpm'],
    ['yarn', 'yarn'],
  ] as const)(
    'uses the selected %s package manager in browser test commands',
    async (packageManager, runPrefix) => {
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
      const playwrightConfig = readFileSync(join(targetDirectory, 'playwright.config.ts'), 'utf8');
      expect(playwrightConfig).toContain(JSON.stringify(runCommand('dev')));
      expect(playwrightConfig).toContain(JSON.stringify(runCommand('start')));
    },
  );
});
