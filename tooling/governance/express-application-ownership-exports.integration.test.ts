import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceExpressApplicationOwnershipDocs } from './express-application-ownership-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const adapterSourcePath = 'packages/platform-express/src/adapter.ts';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function withSourceFiles(
  transform: (source: string) => string,
  sourceFiles: Readonly<Record<string, string>> = {},
): (relativePath: string) => string {
  return (relativePath: string): string => {
    if (relativePath === adapterSourcePath) {
      return transform(read(relativePath));
    }
    return sourceFiles[relativePath] ?? read(relativePath);
  };
}

describe('Express application ownership exported option integration', () => {
  it('rejects locally re-exported existing application options', () => {
    const readFixture = withSourceFiles((source) =>
      source.replace(
        'export interface ExpressAdapterOptions {',
        'interface HiddenOptions {\n  instance: Express;\n}\nexport type { HiddenOptions };\n\nexport interface ExpressAdapterOptions {',
      ),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /existing Express application adoption options/,
    );
  });

  it('rejects an exported option alias imported from a relative module', () => {
    const fixturePath = 'packages/platform-express/src/ownership-options-fixture.ts';
    const readFixture = withSourceFiles(
      (source) =>
        source.replace(
          'export type ExpressNativeMiddleware',
          "import type { ImportedAdapterOptions as HiddenOptions } from './ownership-options-fixture.js';\nexport type ImportedExpressOptions = HiddenOptions;\n\nexport type ExpressNativeMiddleware",
        ),
      {
        [fixturePath]: "import type { Express } from 'express';\nexport interface ImportedAdapterOptions { instance: Express; }\n",
      },
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /existing Express application adoption options/,
    );
  });
});
