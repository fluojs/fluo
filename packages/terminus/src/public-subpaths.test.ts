import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type ExportTarget = {
  import: string;
  types: string;
};

describe('@fluojs/terminus subpath exports', () => {
  it('keeps the redis subpath aligned with emitted dist artifacts', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, ExportTarget>;
    };

    expect(packageJson.exports).toMatchObject({
      './redis': {
        import: './dist/redis.js',
        types: './dist/redis.d.ts',
      },
    });
  });
});
