import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageSourceRoot = dirname(fileURLToPath(import.meta.url));

const rootImportSurfaceFiles = [
  'index.ts',
  'signing/jwks.ts',
  'signing/signer.ts',
  'signing/verifier.ts',
  'refresh/refresh-token.ts',
];

describe('JWT runtime boundary', () => {
  it('keeps node:crypto out of the root import graph until crypto operations execute', async () => {
    for (const sourceFile of rootImportSurfaceFiles) {
      const source = await readFile(resolve(packageSourceRoot, sourceFile), 'utf8');

      expect(source, `${sourceFile} must not statically import node:crypto values`).not.toMatch(
        /^import\s+(?!type\b)[^;]*['"]node:crypto['"]/m,
      );
    }
  });
});
