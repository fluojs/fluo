import { describe, expect, it } from 'vitest';

import {
  collectPublicExportTSDocViolations,
  enforcePublicExportTSDocBaseline,
  isGovernedPublicExportSourcePath,
} from './verify-public-export-tsdoc.mjs';

describe('isGovernedPublicExportSourcePath', () => {
  it('includes ordinary package source files', () => {
    expect(isGovernedPublicExportSourcePath('packages/core/src/module.ts')).toBe(true);
  });

  it('excludes tests, declarations, and non-package paths', () => {
    expect(isGovernedPublicExportSourcePath('packages/core/src/module.test.ts')).toBe(false);
    expect(isGovernedPublicExportSourcePath('packages/core/src/module.d.ts')).toBe(false);
    expect(isGovernedPublicExportSourcePath('tooling/governance/verify-public-export-tsdoc.mjs')).toBe(false);
  });
});

describe('collectPublicExportTSDocViolations', () => {
  it('reports missing summaries and required tags on changed public exports', () => {
    const violations = collectPublicExportTSDocViolations(['packages/core/src/example.ts'], () => `
export function greet(name: string): string {
  return name;
}

/**
 * Configures the example module.
 */
export interface ExampleOptions {
  enabled: boolean;
}
`);

    expect(violations).toEqual([
      {
        kind: 'function',
        line: 2,
        name: 'greet',
        path: 'packages/core/src/example.ts',
        reason: 'summary, @param name, @returns',
      },
    ]);
  });

  it('ignores re-export barrels and accepts practical rich TSDoc', () => {
    const violations = collectPublicExportTSDocViolations(['packages/core/src/example.ts'], () => `
/**
 * Format a greeting for the current caller.
 *
 * @param name Name to interpolate into the greeting.
 * @returns A stable greeting string for HTTP or CLI responses.
 *
 * @example
 * \`\`\`ts
 * greet('Konekti');
 * \`\`\`
 */
export function greet(name: string): string {
  return 'Hello, ' + name;
}

export { greet as createGreeting };
`);

    expect(violations).toEqual([]);
  });
});

describe('enforcePublicExportTSDocBaseline', () => {
  it('throws with actionable guidance when changed exports miss the baseline', () => {
    expect(() =>
      enforcePublicExportTSDocBaseline(['packages/http/src/handler.ts'], () => 'export const HTTP_STATUS = 200;\n'),
    ).toThrowError(/docs\/operations\/public-export-tsdoc-baseline\.md/);
  });
});
