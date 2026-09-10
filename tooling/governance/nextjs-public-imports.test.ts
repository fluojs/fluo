import { describe, expect, it } from 'vitest';

import { enforceNextjsPublicImports, nextjsRecipePaths } from './nextjs-public-imports.mjs';
import { enforceContractCompanionUpdates } from './verify-platform-consistency-governance.mjs';

describe('Next.js public import contract companions', () => {
  it.each([
    'packages/platform-nextjs/README.md',
    'packages/platform-nextjs/README.ko.md',
    'book/03-internals/ch15-nextjs-hosting.md',
    'book/03-internals/ch15-nextjs-hosting.ko.md',
    'apps/docs/content/docs/packages/http-platform.mdx',
    'apps/docs/content/docs/packages/http-platform.ko.mdx',
  ])('requires discoverability and enforcement when %s changes', (path) => {
    // Given a governed recipe changed without its companion evidence.
    // When the existing changed-path gate evaluates the increment.
    // Then the package API contract cannot silently bypass that gate.
    expect(() => enforceContractCompanionUpdates([path])).toThrow(/docs\/CONTEXT\.md/);
  });
});

describe('Next.js executable recipe import ownership', () => {
  it('accepts current EN/KO recipes', () => {
    expect(() => enforceNextjsPublicImports()).not.toThrow();
  });

  it.each(nextjsRecipePaths)('rejects a removed adapter factory import in %s', (path) => {
    const read = (requested: string) => requested === path
      ? "```ts\nimport { createNextAdapter as make } from '@fluojs/platform-nextjs';\nmake();\n```"
      : '';
    expect(() => enforceNextjsPublicImports(read)).toThrow(/NEXTJS_PUBLIC_IMPORT/);
  });

  it.each([
    "import { NextHttpApplicationAdapter } from '@fluojs/platform-nextjs/app-router';",
    "import type { NextAdapterOptions } from '@fluojs/platform-nextjs/pages-router';",
    "import { createNextAppRouterHandler } from '@fluojs/platform-nextjs';",
    "import { createNextPagesRouterHandler } from '@fluojs/platform-nextjs';",
    "import { withFluoNextBackend } from '@fluojs/platform-nextjs';",
    "import * as next from '@fluojs/platform-nextjs'; next.createNextAdapter();",
    "import Next from '@fluojs/platform-nextjs';",
    'const adapter = createNextAdapter();',
  ])('rejects noncanonical runnable code: %s', (source) => {
    expect(() => enforceNextjsPublicImports(() => `\`\`\`typescript\n${source}\n\`\`\``))
      .toThrow(/NEXTJS_PUBLIC_IMPORT/);
  });

  it('accepts aliased static creation, router callbacks, compiler config, and migration prose', () => {
    const source = `Removed: createNextAdapter
\`\`\`typescript
import { NextHttpApplicationAdapter as Adapter, defineNextApplication } from '@fluojs/platform-nextjs';
import { createNextAppRouterHandler } from '@fluojs/platform-nextjs/app-router';
import { createNextPagesRouterHandler, type NextPagesRouterConfig } from '@fluojs/platform-nextjs/pages-router';
import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';
const adapter = Adapter.create();
const get = defineNextApplication({ key: 'fixture', load: async () => adapter });
const { GET, POST, HEAD } = createNextAppRouterHandler(get);
const pages = createNextPagesRouterHandler(get);
withFluoNextBackend({});
\`\`\``;
    expect(() => enforceNextjsPublicImports(() => source)).not.toThrow();
  });
});
