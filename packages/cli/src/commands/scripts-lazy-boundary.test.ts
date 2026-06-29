import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('script command lazy boundaries', () => {
  it('keeps optional Studio sidecar loading behind the dev --studio path', () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const scriptsSource = readFileSync(join(sourceRoot, 'scripts.ts'), 'utf8');

    expect(scriptsSource).not.toContain("import { startStudioSidecar");
    expect(scriptsSource).toContain("import type { startStudioSidecar");
    expect(scriptsSource).toContain("await import('../studio/sidecar.js')");
  });
});
