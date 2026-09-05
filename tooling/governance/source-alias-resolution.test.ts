import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceAliases = {
  '@fluojs/platform-nodejs': 'packages/platform-nodejs/src/index.ts',
  '@fluojs/platform-nodejs/internal': 'packages/platform-nodejs/src/internal.ts',
} as const;

function parseConfig(relativeConfigPath: string): ts.ParsedCommandLine {
  const configPath = join(repoRoot, relativeConfigPath);
  const config = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'));
  expect(config.error).toBeUndefined();

  return ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), undefined, configPath);
}

describe('repository source aliases', () => {
  it.each(['examples/tsconfig.json', 'tooling/benchmarks/http-comparison/tsconfig.json'])(
    'resolves moved Node platform entrypoints from source with cold dist for %s',
    (relativeConfigPath) => {
      const parsedConfig = parseConfig(relativeConfigPath);
      const host: ts.ModuleResolutionHost = {
        ...ts.sys,
        fileExists: (path) => !path.includes(`${sep}dist${sep}`) && ts.sys.fileExists(path),
      };
      const containingFile = join(dirname(join(repoRoot, relativeConfigPath)), '__source-alias-resolution__.ts');

      for (const [specifier, expectedRelativePath] of Object.entries(sourceAliases)) {
        const resolution = ts.resolveModuleName(specifier, containingFile, parsedConfig.options, host);

        expect(resolution.resolvedModule?.resolvedFileName, specifier).toBe(join(repoRoot, expectedRelativePath));
      }
    },
  );
});
