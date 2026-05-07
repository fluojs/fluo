import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RUNTIME_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const CORE_INTERNAL_IMPORT = '@fluojs/core' + '/internal';
const HTTP_INTERNAL_IMPORT = '@fluojs/http' + '/internal';

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }

  return files;
}

describe('runtime peer package internal dependencies', () => {
  it('keeps peer internal imports isolated behind runtime-owned seams', async () => {
    const files = await collectTypeScriptFiles(RUNTIME_SRC_DIR);
    const importHits: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of [CORE_INTERNAL_IMPORT, HTTP_INTERNAL_IMPORT]) {
        if (source.includes(specifier)) {
          importHits.push({
            file: relative(RUNTIME_SRC_DIR, file),
            specifier,
          });
        }
      }
    }

    expect(importHits).toEqual([
      { file: 'internal/core-metadata.ts', specifier: CORE_INTERNAL_IMPORT },
      { file: 'internal/http-runtime.ts', specifier: HTTP_INTERNAL_IMPORT },
    ]);
  });
});
