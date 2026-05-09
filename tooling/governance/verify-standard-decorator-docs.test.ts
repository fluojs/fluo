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

function collectParameterInjectExamplesFromSource(source: string, file: string): string[] {
  const invalidInjectUsages = [
    /constructor\s*\([^)]*@Inject\(/gs,
    /@Inject\([^\n]*\)\s*(?:(?:public|private|protected|readonly|declare|static)\s+)*[A-Za-z_$][\w$]*[!?]?\s*:/g,
  ];

  return [...new Set(invalidInjectUsages.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => {
      const line = lineNumberForOffset(source, match.index ?? 0);
      const excerpt = source.split('\n')[line - 1]?.trim() ?? match[0];
      return `${relative(process.cwd(), file)}:${line} ${excerpt}`;
    }),
  ))];
}

function collectParameterInjectExamples(files: string[]): string[] {
  return files.flatMap((file) => collectParameterInjectExamplesFromSource(readFileSync(file, 'utf8'), file));
}

describe('standard decorator documentation', () => {
  it('detects parameter and property decorator-shaped @Inject examples', () => {
    const source = `
class ServiceA {
  constructor(dep: DepA, @Inject(DepB) private readonly depB: DepB) {}
}

class ServiceB {
  @Inject(TOKEN)
  dep!: Dep;
}

class ServiceC {
  @Inject(OTHER_TOKEN) private readonly other: Other;
}
`;

    expect(collectParameterInjectExamplesFromSource(source, 'docs/example.md')).toEqual([
      'docs/example.md:3 constructor(dep: DepA, @Inject(DepB) private readonly depB: DepB) {}',
      'docs/example.md:7 @Inject(TOKEN)',
      'docs/example.md:12 @Inject(OTHER_TOKEN) private readonly other: Other;',
    ]);
  });

  it('allows class-level @Inject examples', () => {
    const source = `
@Inject(DepA, optional(DepB))
class Service {
  constructor(private readonly depA: DepA, private readonly depB: DepB | undefined) {}
}
`;

    expect(collectParameterInjectExamplesFromSource(source, 'docs/example.md')).toEqual([]);
  });

  it('does not teach fluo @Inject as a parameter or property decorator', () => {
    const markdownFiles = DOCUMENTATION_ROOTS.flatMap((root) => collectMarkdownFiles(join(process.cwd(), root)));

    expect(collectParameterInjectExamples(markdownFiles)).toEqual([]);
  });
});
