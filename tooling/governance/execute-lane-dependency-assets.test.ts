import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('execute-lane dependency scheduler assets', () => {
  it('ships the parent gate and per-issue binding modules', () => {
    // Given
    const skillRoot = resolve(process.cwd(), '.agents/skills/execute-lane');
    const assets = [
      'scripts/dag-binding-files.mjs',
      'scripts/dependency-gate.mjs',
      'scripts/issue-dag-binding.mjs',
      'scripts/issue-dispatch.mjs',
      'scripts/supervisor-terminal-evidence.mjs',
    ];

    // When
    const shipped = assets.filter((path) =>
      existsSync(resolve(skillRoot, path)),
    );

    // Then
    expect(shipped).toEqual(assets);
  });
});
