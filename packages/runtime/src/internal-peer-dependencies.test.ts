import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RUNTIME_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const CORE_INTERNAL_IMPORT = '@fluojs/core' + '/internal';
const HTTP_INTERNAL_IMPORT = '@fluojs/http' + '/internal';
const CONFIG_PACKAGE_NAME = '@fluojs/' + 'config';

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

    expect([...importHits].sort((left, right) => {
      const fileOrder = left.file.localeCompare(right.file);
      return fileOrder === 0 ? left.specifier.localeCompare(right.specifier) : fileOrder;
    })).toEqual([
      { file: 'internal/core-metadata.ts', specifier: CORE_INTERNAL_IMPORT },
      { file: 'internal/http-runtime.ts', specifier: HTTP_INTERNAL_IMPORT },
      { file: 'internal/route-inspection-metadata.ts', specifier: CORE_INTERNAL_IMPORT },
    ]);
  });

  it('does not publish a production dependency the runtime source never imports', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(RUNTIME_SRC_DIR, '../package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const files = await collectTypeScriptFiles(RUNTIME_SRC_DIR);
    const importingFiles: string[] = [];

    for (const file of files) {
      if ((await readFile(file, 'utf8')).includes(CONFIG_PACKAGE_NAME)) {
        importingFiles.push(relative(RUNTIME_SRC_DIR, file));
      }
    }

    expect(importingFiles).toEqual([]);
    expect(manifest.dependencies ?? {}).not.toHaveProperty(CONFIG_PACKAGE_NAME);
    expect(manifest.devDependencies ?? {}).not.toHaveProperty(CONFIG_PACKAGE_NAME);
  });
});
