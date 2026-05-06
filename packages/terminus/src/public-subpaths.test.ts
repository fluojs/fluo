import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type ExportTarget = {
  import: string;
  types: string;
};

describe('@fluojs/terminus subpath exports', () => {
  it('keeps the node and redis subpaths aligned with emitted dist artifacts', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, ExportTarget>;
    };

    expect(packageJson.exports).toMatchObject({
      './node': {
        import: './dist/node.js',
        types: './dist/node.d.ts',
      },
      './redis': {
        import: './dist/redis.js',
        types: './dist/redis.d.ts',
      },
    });
  });
});
