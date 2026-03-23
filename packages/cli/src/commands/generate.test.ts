import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGenerateCommand } from './generate.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('runGenerateCommand', () => {
  it('rejects empty resource names', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-generate-'));
    tempDirectories.push(workspaceDirectory);

    expect(() => runGenerateCommand('service', '   ', workspaceDirectory)).toThrow('name must not be empty');
  });

  it('rejects traversal-style resource names', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-generate-'));
    tempDirectories.push(workspaceDirectory);

    expect(() => runGenerateCommand('service', '../User', workspaceDirectory)).toThrow('path separators or traversal sequences');
  });

  it('updates existing module metadata and imports without duplication', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const domainDirectory = join(sourceDirectory, 'posts');
    const modulePath = join(domainDirectory, 'post.module.ts');
    mkdirSync(domainDirectory, { recursive: true });

    writeFileSync(modulePath, `import { Module } from '@konekti/core';\nimport { ExistingService } from './existing.service';\n\n@Module({ providers:[ExistingService], controllers:[] })\nclass PostModule {}\n\nexport { PostModule };\n`);

    runGenerateCommand('service', 'Post', sourceDirectory);
    runGenerateCommand('service', 'Post', sourceDirectory);

    const moduleContent = readFileSync(modulePath, 'utf8');
    const occurrences = (moduleContent.match(/PostService/g) ?? []).length;

    expect(existsSync(join(domainDirectory, 'post.service.ts'))).toBe(true);
    expect(moduleContent).toContain('ExistingService');
    expect(moduleContent).toContain('PostService');
    expect(moduleContent).toContain('from "./post.service"');
    expect(occurrences).toBe(2);
  });

  it('does not write generated files when module rewrite preflight fails', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const domainDirectory = join(sourceDirectory, 'posts');
    const modulePath = join(domainDirectory, 'post.module.ts');
    mkdirSync(domainDirectory, { recursive: true });

    writeFileSync(
      modulePath,
      `import { Module } from '@konekti/core';

@Module({ providers: ExistingService })
class PostModule {}

export { PostModule };
`,
      'utf8',
    );

    expect(() => runGenerateCommand('service', 'Post', sourceDirectory)).toThrow('"providers" must be an array');
    expect(existsSync(join(domainDirectory, 'post.service.ts'))).toBe(false);
  });
});
