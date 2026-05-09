import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOCUMENTATION_ROOTS = ['README.md', 'README.ko.md', 'docs', 'book', 'packages'] as const;
const SKIPPED_DIRECTORIES = new Set(['.git', '.worktrees', 'coverage', 'dist', 'node_modules']);

function collectMarkdownFiles(path: string): string[] {
  const stat = statSync(path);

  if (stat.isFile()) {
    return path.endsWith('.md') ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry)) {
      return [];
    }

    return collectMarkdownFiles(join(path, entry));
  });
}

function lineNumberForOffset(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function collectParameterInjectExamples(files: string[]): string[] {
  const invalidInjectUsages = [
    /constructor\s*\(\s*@Inject\(/g,
    /@Inject\([^\n]*\)\s+(?:public|private|protected|readonly)\b/g,
  ];

  return files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');

    return invalidInjectUsages.flatMap((pattern) =>
      [...source.matchAll(pattern)].map((match) => {
        const line = lineNumberForOffset(source, match.index ?? 0);
        const excerpt = source.split('\n')[line - 1]?.trim() ?? match[0];
        return `${relative(process.cwd(), file)}:${line} ${excerpt}`;
      }),
    );
  });
}

describe('standard decorator documentation', () => {
  it('does not teach fluo @Inject as a parameter or property decorator', () => {
    const markdownFiles = DOCUMENTATION_ROOTS.flatMap((root) => collectMarkdownFiles(join(process.cwd(), root)));

    expect(collectParameterInjectExamples(markdownFiles)).toEqual([]);
  });
});
