import { describe, expect, it, vi } from 'vitest';

import {
  type TypegenArtifactFileSystem,
  writeTypegenArtifact,
} from './typegen-artifact.js';

describe('typegen artifact commits', () => {
  it('preserves the last valid artifact when the atomic replacement fails', async () => {
    // Given: one valid target and a filesystem that fails only when committing its temporary replacement.
    const outputPath = '/project/src/generated/react-pages.ts';
    const files = new Map<string, string>([[outputPath, 'last valid artifact\n']]);
    const commitError = new Error('rename failed');
    const fileSystem: TypegenArtifactFileSystem = {
      mkdir: vi.fn(async () => undefined),
      readFile: vi.fn(async (path) => {
        const content = files.get(path);
        if (content === undefined) {
          throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
        }
        return content;
      }),
      rename: vi.fn(async () => {
        throw commitError;
      }),
      rm: vi.fn(async (path) => {
        files.delete(path);
      }),
      writeFile: vi.fn(async (path, content) => {
        files.set(path, content);
      }),
    };

    // When: the command prepares a complete replacement but cannot atomically publish it.
    const action = writeTypegenArtifact(outputPath, 'next complete artifact\n', fileSystem);

    // Then: the original target remains valid and the temporary file is removed.
    await expect(action).rejects.toBe(commitError);
    expect(files.get(outputPath)).toBe('last valid artifact\n');
    expect([...files.keys()]).toEqual([outputPath]);
    expect(fileSystem.rm).toHaveBeenCalledOnce();
  });
});
