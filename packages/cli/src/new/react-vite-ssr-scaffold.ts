import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PackageManager } from './types.js';

type ReactViteSsrTemplate = {
  outputPath: string;
  templatePath: string;
};

type ReactViteSsrTemplateContext = {
  readonly packageManager: PackageManager;
  readonly projectName: string;
};

type ReactViteSsrScaffoldFile = {
  content: string;
  path: string;
};

type ReactViteSsrLifecycleCommands = {
  readonly build: string;
  readonly dev: string;
  readonly install: string;
  readonly start: string;
  readonly test: string;
  readonly testBrowser: string;
  readonly typecheck: string;
};

const INSTALL_COMMAND_BY_PACKAGE_MANAGER = {
  bun: 'bun install',
  npm: 'npm install',
  pnpm: 'pnpm install',
  yarn: 'yarn install',
} as const satisfies Readonly<Record<PackageManager, string>>;

const RUN_PREFIX_BY_PACKAGE_MANAGER = {
  bun: 'bun run',
  npm: 'npm run',
  pnpm: 'pnpm',
  yarn: 'yarn',
} as const satisfies Readonly<Record<PackageManager, string>>;

const REACT_VITE_SSR_TEMPLATES: readonly ReactViteSsrTemplate[] = [
  { outputPath: 'README.md', templatePath: 'README.md.ejs' },
  { outputPath: 'playwright.config.ts', templatePath: 'playwright.config.ts.ejs' },
  { outputPath: 'tsconfig.json', templatePath: 'tsconfig.json.ejs' },
  { outputPath: 'vite.client.config.ts', templatePath: 'vite.client.config.ts.ejs' },
  { outputPath: 'vite.server.config.ts', templatePath: 'vite.server.config.ts.ejs' },
  { outputPath: 'vitest.config.ts', templatePath: 'vitest.config.ts.ejs' },
  { outputPath: 'src/app.test.ts', templatePath: 'src/app.test.ts.ejs' },
  { outputPath: 'src/app.tsx', templatePath: 'src/app.tsx.ejs' },
  { outputPath: 'src/entry-client.tsx', templatePath: 'src/entry-client.tsx.ejs' },
  { outputPath: 'src/entry-server.tsx', templatePath: 'src/entry-server.tsx.ejs' },
  { outputPath: 'src/load-manifest.test.ts', templatePath: 'src/load-manifest.test.ts.ejs' },
  { outputPath: 'src/load-manifest.ts', templatePath: 'src/load-manifest.ts.ejs' },
  { outputPath: 'src/main.ts', templatePath: 'src/main.ts.ejs' },
  { outputPath: 'src/page.tsx', templatePath: 'src/page.tsx.ejs' },
  { outputPath: 'src/react-app.test.tsx', templatePath: 'src/react-app.test.tsx.ejs' },
  { outputPath: 'src/react-app.tsx', templatePath: 'src/react-app.tsx.ejs' },
  { outputPath: 'src/styles.css', templatePath: 'src/styles.css.ejs' },
  { outputPath: 'src/styles.d.ts', templatePath: 'src/styles.d.ts.ejs' },
  { outputPath: 'tests/production-hydration.spec.ts', templatePath: 'tests/production-hydration.spec.ts.ejs' },
];

function resolveTemplateDirectory(importMetaUrl: string): string {
  return join(dirname(fileURLToPath(importMetaUrl)), 'templates', 'react-vite-ssr');
}

function createLifecycleCommands(packageManager: PackageManager): ReactViteSsrLifecycleCommands {
  const runPrefix = RUN_PREFIX_BY_PACKAGE_MANAGER[packageManager];
  const run = (script: string) => `${runPrefix} ${script}`;

  return {
    build: run('build'),
    dev: run('dev'),
    install: INSTALL_COMMAND_BY_PACKAGE_MANAGER[packageManager],
    start: run('start'),
    test: run('test'),
    testBrowser: run('test:browser'),
    typecheck: run('typecheck'),
  };
}

/**
 * Renders the React SSR + Vite starter template tree with explicit lifecycle commands.
 *
 * @param context Validated project and package-manager command values for template rendering.
 * @param importMetaUrl Module URL used to locate packaged starter templates.
 * @returns Generated scaffold files with rendered template content.
 */
export function createReactViteSsrScaffoldFiles(
  context: ReactViteSsrTemplateContext,
  importMetaUrl = import.meta.url,
): ReactViteSsrScaffoldFile[] {
  const templateDirectory = resolveTemplateDirectory(importMetaUrl);
  const commands = createLifecycleCommands(context.packageManager);

  return REACT_VITE_SSR_TEMPLATES.map(({ outputPath, templatePath }) => ({
    content: readFileSync(join(templateDirectory, templatePath), 'utf8')
      .replaceAll('<%= projectName %>', context.projectName)
      .replaceAll('<%= installCommand %>', commands.install)
      .replaceAll('<%= devCommand %>', commands.dev)
      .replaceAll('<%= buildCommand %>', commands.build)
      .replaceAll('<%= startCommand %>', commands.start)
      .replaceAll('<%= testCommand %>', commands.test)
      .replaceAll('<%= testBrowserCommand %>', commands.testBrowser)
      .replaceAll('<%= typecheckCommand %>', commands.typecheck)
      .replaceAll('<%= devCommandJson %>', JSON.stringify(commands.dev))
      .replaceAll('<%= startCommandJson %>', JSON.stringify(commands.start)),
    path: outputPath,
  }));
}
