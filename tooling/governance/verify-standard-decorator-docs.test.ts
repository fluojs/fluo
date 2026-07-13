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

  it('keeps constructor injection and forwardRef migration boundaries explicit in both locales', () => {
    const englishBeginner = readFileSync('book/beginner/ch04-decorators-intro.md', 'utf8');
    const koreanBeginner = readFileSync('book/beginner/ch04-decorators-intro.ko.md', 'utf8');
    const englishAdvanced = readFileSync('book/advanced/ch16-custom-package.md', 'utf8');
    const koreanAdvanced = readFileSync('book/advanced/ch16-custom-package.ko.md', 'utf8');
    const englishMigration = readFileSync('docs/getting-started/migrate-from-nestjs.md', 'utf8');
    const koreanMigration = readFileSync('docs/getting-started/migrate-from-nestjs.ko.md', 'utf8');

    expect(englishBeginner).toMatch(/class-level `@Inject\(\.\.\.\)`[^\n]+not a property-injection Decorator/u);
    expect(koreanBeginner).toMatch(/클래스 수준 `@Inject\(\.\.\.\)`[^\n]+속성 주입 데코레이터가 아닙니다/u);
    expect(englishAdvanced).toMatch(/rejects circular Module imports[^\n]+Do not wrap entries in `imports` with `forwardRef\(\)`/u);
    expect(koreanAdvanced).toMatch(/순환 모듈 import를 거부[^\n]+`imports` 항목을 `forwardRef\(\)`로 감싸지 마세요/u);
    expect(englishMigration).toMatch(/property injection MUST become constructor injection/u);
    expect(englishMigration).toMatch(/Module `forwardRef\(\.\.\.\)` has no fluo equivalent/u);
    expect(koreanMigration).toMatch(/속성 주입은 반드시 생성자 주입으로 바꾼다/u);
    expect(koreanMigration).toMatch(/모듈 `forwardRef\(\.\.\.\)`에 직접 대응하는 fluo 기능은 없다/u);
  });
});
