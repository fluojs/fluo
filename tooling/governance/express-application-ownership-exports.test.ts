import { describe, expect, it } from 'vitest';

import { findExportedApplicationOptions } from './express-application-ownership-exports.mjs';

const sourcePath = 'packages/platform-express/src/adapter.ts';

function exportedApplicationNames(source: string, sourceFiles: Readonly<Record<string, string>> = {}): string[] {
  return findExportedApplicationOptions({
    content: source,
    readText: (relativePath: string): string => sourceFiles[relativePath] ?? '',
    sourcePath,
  });
}

describe('Express application ownership export resolution', () => {
  it('resolves a locally re-exported interface', () => {
    const names = exportedApplicationNames(`
      interface HiddenOptions { instance: Express }
      export type { HiddenOptions };
    `);

    expect(names).toEqual(['HiddenOptions']);
  });

  it('resolves an exported alias imported from a relative module', () => {
    const fixturePath = 'packages/platform-express/src/ownership-options-fixture.ts';
    const names = exportedApplicationNames(
      `
        import type { ImportedOptions as HiddenOptions } from './ownership-options-fixture.js';
        export type ImportedExpressOptions = HiddenOptions;
      `,
      {
        [fixturePath]: `
          import type { Express } from 'express';
          export interface ImportedOptions { instance: Express }
        `,
      },
    );

    expect(names).toEqual(['ImportedExpressOptions']);
  });
});
