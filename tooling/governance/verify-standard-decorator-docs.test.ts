import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOCUMENTATION_ROOTS = ['README.md', 'README.ko.md', 'docs', 'book', 'packages', 'apps/docs'] as const;
const SKIPPED_DIRECTORIES = new Set(['.git', '.worktrees', 'coverage', 'dist', 'node_modules']);
const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.mdx']);

function collectMarkdownFiles(path: string): string[] {
  const stat = statSync(path);

  if (stat.isFile()) {
    return DOCUMENTATION_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) ? [path] : [];
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
  const constructorInjectUsage = /constructor\s*\([^)]*@Inject\(/gs;
  const propertyDeclaration = /^(?:(?:public|private|protected|readonly|declare|static)\s+)*[A-Za-z_$][\w$]*[!?]?\s*:/;
  const lines = source.split('\n');
  const invalidExamples = [...source.matchAll(constructorInjectUsage)].map((match) => {
    const line = lineNumberForOffset(source, match.index ?? 0);
    const excerpt = lines[line - 1]?.trim() ?? match[0];
    return `${relative(process.cwd(), file)}:${line} ${excerpt}`;
  });

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmedLine = line.trim();
    const injectIndex = trimmedLine.startsWith('@Inject(') ? 0 : -1;

    if (injectIndex === -1) {
      continue;
    }

    const sameLineAfterInjectCall = trimmedLine.replace(/^@Inject\([^)]*\)/, '');

    if (propertyDeclaration.test(sameLineAfterInjectCall.trim())) {
      invalidExamples.push(`${relative(process.cwd(), file)}:${index + 1} ${line.trim()}`);
      continue;
    }

    let decoratorEndLine = index;

    while (decoratorEndLine < lines.length && !(lines[decoratorEndLine] ?? '').includes(')')) {
      decoratorEndLine += 1;
    }

    const nextLineIndex = decoratorEndLine + 1;
    const nextLine = lines[nextLineIndex]?.trim() ?? '';

    if (nextLine !== '' && propertyDeclaration.test(nextLine)) {
      invalidExamples.push(`${relative(process.cwd(), file)}:${index + 1} ${line.trim()}`);
    }
  }

  return [...new Set(invalidExamples)].sort(
    (left, right) => Number(left.match(/:(\d+) /)?.[1] ?? 0) - Number(right.match(/:(\d+) /)?.[1] ?? 0),
  );
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

class ServiceA2 {
  constructor(
    dep: DepA,
    @Inject(DepB) private readonly depB: DepB,
  ) {}
}

class ServiceB {
  @Inject(TOKEN)
  dep!: Dep;
}

class ServiceB2 {
  @Inject(TOKEN)
  private readonly dep!: Dep;
}

class ServiceB3 {
  @Inject(
    TOKEN
  )
  private readonly dep!: Dep;
}

class ServiceC {
  @Inject(OTHER_TOKEN) private readonly other: Other;
}
`;

    expect(collectParameterInjectExamplesFromSource(source, 'docs/example.md')).toEqual([
      'docs/example.md:3 constructor(dep: DepA, @Inject(DepB) private readonly depB: DepB) {}',
      'docs/example.md:7 constructor(',
      'docs/example.md:9 @Inject(DepB) private readonly depB: DepB,',
      'docs/example.md:14 @Inject(TOKEN)',
      'docs/example.md:19 @Inject(TOKEN)',
      'docs/example.md:24 @Inject(',
      'docs/example.md:31 @Inject(OTHER_TOKEN) private readonly other: Other;',
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
