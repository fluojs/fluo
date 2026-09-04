import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

describe('@fluojs/openapi package dependency contract', () => {
  it('does not declare validation as a runtime dependency', () => {
    // Given
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    // When
    const runtimeDependencies = manifest.dependencies;

    // Then
    expect(runtimeDependencies).not.toHaveProperty('@fluojs/validation');
  });
});
