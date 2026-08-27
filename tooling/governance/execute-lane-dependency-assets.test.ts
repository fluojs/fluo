import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('execute-lane dependency scheduler assets', () => {
  it('ships the parent coordinator and issue-DAG control modules', () => {
    // Given
    const skillRoot = resolve(process.cwd(), '.agents/skills/execute-lane');
    const assets = [
      'scripts/dependency-gate.mjs',
      'scripts/issue-dag-contracts.mjs',
      'scripts/issue-dag-files.mjs',
      'scripts/issue-dag-store.mjs',
      'scripts/lane-coordinator.mjs',
      'scripts/native-dag-run.mjs',
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
