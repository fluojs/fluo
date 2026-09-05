import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

function collectProductionTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectProductionTypeScript(path);
    }

    return extname(path) === '.ts' && !path.endsWith('.test.ts') && !path.endsWith('.test-fixture.ts')
      ? [path]
      : [];
  });
}

describe('@fluojs/runtime portable package boundary', () => {
  it('publishes no Node engine or Node-only entrypoint', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      devDependencies?: Record<string, string>;
      engines?: { node?: string };
      exports: Record<string, unknown>;
    };

    expect(manifest.engines?.node).toBeUndefined();
    expect(manifest.devDependencies).not.toHaveProperty('@fluojs/platform-nodejs');
    expect(manifest.exports).not.toHaveProperty('./node');
    expect(manifest.exports).not.toHaveProperty('./internal-node');
  });

  it('preserves every intentional runtime-neutral engine omission', () => {
    for (const packageName of [
      'email',
      'i18n',
      'platform-bun',
      'platform-cloudflare-workers',
      'platform-deno',
      'react',
    ]) {
      const manifest = JSON.parse(
        readFileSync(new URL(`../../${packageName}/package.json`, import.meta.url), 'utf8'),
      ) as { engines?: { node?: string } };

      expect(manifest.engines?.node, packageName).toBeUndefined();
    }
  });

  it('contains no eager Node builtin imports in published production source', () => {
    const sourceRoot = new URL('.', import.meta.url);
    const eagerNodeImports = collectProductionTypeScript(sourceRoot.pathname).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return /(?:from\s+|import\s*\()['"]node:/u.test(source) ? [path] : [];
    });

    expect(eagerNodeImports).toEqual([]);
  });
});
