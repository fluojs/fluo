import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ReactViteSsrTemplate = {
  outputPath: string;
  templatePath: string;
};

export type ReactViteSsrScaffoldFile = {
  content: string;
  path: string;
};

const REACT_VITE_SSR_TEMPLATES: readonly ReactViteSsrTemplate[] = [
  { outputPath: 'README.md', templatePath: 'README.md.ejs' },
  { outputPath: 'playwright.config.ts', templatePath: 'playwright.config.ts.ejs' },
  { outputPath: 'tsconfig.json', templatePath: 'tsconfig.json.ejs' },
  { outputPath: 'vite.client.config.ts', templatePath: 'vite.client.config.ts.ejs' },
  { outputPath: 'vite.server.config.ts', templatePath: 'vite.server.config.ts.ejs' },
  { outputPath: 'vitest.config.ts', templatePath: 'vitest.config.ts.ejs' },
  { outputPath: 'src/app.test.ts', templatePath: 'src/app.test.ts.ejs' },
  { outputPath: 'src/app.ts', templatePath: 'src/app.ts.ejs' },
  { outputPath: 'src/entry-client.tsx', templatePath: 'src/entry-client.tsx.ejs' },
  { outputPath: 'src/entry-server.ts', templatePath: 'src/entry-server.ts.ejs' },
  { outputPath: 'src/hydration.test.tsx', templatePath: 'src/hydration.test.tsx.ejs' },
  { outputPath: 'src/hydration.ts', templatePath: 'src/hydration.ts.ejs' },
  { outputPath: 'src/main.ts', templatePath: 'src/main.ts.ejs' },
  { outputPath: 'src/page.tsx', templatePath: 'src/page.tsx.ejs' },
  { outputPath: 'src/styles.css', templatePath: 'src/styles.css.ejs' },
  { outputPath: 'src/styles.d.ts', templatePath: 'src/styles.d.ts.ejs' },
  { outputPath: 'tests/production-hydration.spec.ts', templatePath: 'tests/production-hydration.spec.ts.ejs' },
];

function resolveTemplateDirectory(importMetaUrl: string): string {
  return join(dirname(fileURLToPath(importMetaUrl)), 'templates', 'react-vite-ssr');
}

export function createReactViteSsrScaffoldFiles(
  projectName: string,
  importMetaUrl = import.meta.url,
): ReactViteSsrScaffoldFile[] {
  const templateDirectory = resolveTemplateDirectory(importMetaUrl);

  return REACT_VITE_SSR_TEMPLATES.map(({ outputPath, templatePath }) => ({
    content: readFileSync(join(templateDirectory, templatePath), 'utf8').replaceAll('<%= projectName %>', projectName),
    path: outputPath,
  }));
}
