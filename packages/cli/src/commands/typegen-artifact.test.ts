import { describe, expect, it, vi } from 'vitest';

import {
  type TypegenArtifactFileSystem,
  writeTypegenArtifact,
} from './typegen-artifact.js';

describe('typegen artifact commits', () => {
  it('removes a prepared replacement when shutdown aborts before atomic publication', async () => {
    // Given: an existing valid artifact and a shutdown signal that begins during temporary-file preparation.
    const outputPath = '/project/src/generated/react-pages.ts';
    const files = new Map<string, string>([[outputPath, 'last valid artifact\n']]);
    const controller = new AbortController();
    const fileSystem: TypegenArtifactFileSystem = {
      mkdir: vi.fn(async () => undefined),
      readFile: vi.fn(async (path) => {
        const content = files.get(path);
        if (content === undefined) {
          throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
        }
        return content;
      }),
      rename: vi.fn(async (source, destination) => {
        const content = files.get(source);
        if (content === undefined) {
          throw new Error(`Missing temporary artifact ${source}`);
        }
        files.set(destination, content);
        files.delete(source);
      }),
      rm: vi.fn(async (path) => {
        files.delete(path);
      }),
      writeFile: vi.fn(async (path, content) => {
        files.set(path, content);
        controller.abort();
      }),
    };

    // When: shutdown aborts the owned write after its complete temporary body exists.
    const action = writeTypegenArtifact(outputPath, 'next complete artifact\n', fileSystem, controller.signal);

    // Then: atomic publication never starts, the temporary file is removed, and the last valid target remains.
    await expect(action).rejects.toMatchObject({ name: 'AbortError' });
    expect(files.get(outputPath)).toBe('last valid artifact\n');
    expect(fileSystem.rename).not.toHaveBeenCalled();
    expect([...files.keys()]).toEqual([outputPath]);
  });

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
