import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function interfaceBody(source: string, name: string): string {
  const match = source.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));

  if (!match?.[1]) {
    throw new Error(`Expected ${name} to remain an exported interface.`);
  }

  return match[1];
}

describe('Studio runtime-neutral diagnostics contract', () => {
  it('keeps the check and aggregate report declarations runtime-neutral', () => {
    // Given
    const contracts = read('packages/studio/src/contracts.ts');

    // When
    const checkResult = /export interface PlatformCheckResult\s*\{\s*name: string;\s*status: 'pass' \| 'fail' \| 'degraded';\s*message\?: string;\s*\}/;
    const readinessReport = interfaceBody(contracts, 'PlatformReadinessReport');
    const healthReport = interfaceBody(contracts, 'PlatformHealthReport');

    // Then
    expect(contracts).toMatch(checkResult);
    expect(readinessReport).toContain('checks?: PlatformCheckResult[];');
    expect(healthReport).toContain('checks?: PlatformCheckResult[];');
  });

  it('documents the runtime-neutral report contract in both package-surface guides', () => {
    // Given
    const packageSurface = read('docs/reference/package-surface.md');
    const packageSurfaceKo = read('docs/reference/package-surface.ko.md');

    // When
    const reportTypes = '`PlatformCheckResult`, `PlatformReadinessReport`, and `PlatformHealthReport`';
    const reportTypesKo = '`PlatformCheckResult`, `PlatformReadinessReport`, `PlatformHealthReport`';

    // Then
    expect(packageSurface).toContain(reportTypes);
    expect(packageSurface).toContain('optional `checks`');
    expect(packageSurfaceKo).toContain(reportTypesKo);
    expect(packageSurfaceKo).toContain('선택적 `checks`');
  });
});
