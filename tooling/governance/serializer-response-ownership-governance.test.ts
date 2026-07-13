import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceSerializerResponseOwnershipDocsSync } from './verify-platform-consistency-governance.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('serializer response ownership governance', () => {
  it('keeps the bilingual package and governed documentation synchronized', () => {
    expect(() => enforceSerializerResponseOwnershipDocsSync()).not.toThrow();
  });

  it('rejects missing runtime response ownership guidance', () => {
    expect(() =>
      enforceSerializerResponseOwnershipDocsSync((relativePath: string) => {
        const content = readFileSync(join(repoRoot, relativePath), 'utf8');
        return relativePath === 'packages/runtime/README.md'
          ? content.replace('skips its normal success-response write', 'writes the handler result again')
          : content;
      }),
    ).toThrowError(/packages\/runtime\/README\.md must keep serializer response ownership guidance synchronized/);
  });
});
