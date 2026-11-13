import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stabilityRows = {
  '': '| Long-term ecosystem maturity expected by conservative NestJS adopters | Still developing. This ecosystem-maturity gap is separate from release stability: public `1.0+` packages are Official, and breaking changes require a major version bump. `@fluojs/validation` follows that Official-tier stability contract. | `docs/contracts/release-governance.md`, `packages/validation/package.json`, `packages/validation/CHANGELOG.md` |',
  '.ko': '| 보수적인 NestJS 도입자가 기대하는 장기 생태계 성숙도 | 계속 발전 중입니다. 이 생태계 성숙도 격차는 릴리스 안정성과 별개입니다. 공개 `1.0+` 패키지는 Official이며 breaking change에는 major version bump가 필요합니다. `@fluojs/validation`은 이 Official tier 안정성 계약을 따릅니다. | `docs/contracts/release-governance.md`, `packages/validation/package.json`, `packages/validation/CHANGELOG.md` |',
};

function defaultReadText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function sectionLines(text, heading, path) {
  const lines = text.split('\n');
  const starts = lines.flatMap((line, index) => line === heading ? [index] : []);
  if (starts.length !== 1) {
    throw new Error(`${path}: ${heading} must appear exactly once; found ${starts.length}.`);
  }
  const rest = lines.slice(starts[0] + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Keep required-string examples and validation release claims aligned with
 * the missing-value and Official-tier contracts in both documentation locales.
 *
 * @param readText Optional reader for mutation fixtures.
 */
export function enforceValidationRequirednessDocs(readText = defaultReadText) {
  for (const locale of ['', '.ko']) {
    const chapterPath = `book/beginner/ch06-validation${locale}.md`;
    const chapter = readText(chapterPath);
    const section = sectionLines(chapter, '## 6.2 Defining CreatePostDto with Validation Rules', chapterPath).join('\n');
    const examples = [...section.matchAll(/^```typescript\n([\s\S]*?)^```$/gmu)]
      .map((match) => match[1]);
    const example = examples[0];
    const imports = example?.match(/import\s*\{([^}]+)\}\s*from\s*['"]@fluojs\/validation['"]/u);

    if (!imports?.[1].split(',').some((name) => name.trim() === 'IsDefined')) {
      throw new Error(`${chapterPath}: CreatePostDto must import IsDefined from @fluojs/validation.`);
    }

    const fieldBlocks = example.split('export class CreatePostDto {\n')[1]?.split('\n\n') ?? [];
    for (const [index, field, minimum] of [[0, 'title', 3], [1, 'body', 10]]) {
      const block = fieldBlocks[index]?.split('\n');
      const expected = ['  @IsDefined()', '  @IsString()', `  @MinLength(${minimum})`, `  ${field} = '';`];
      const actual = block;
      if (!actual || actual.join('\n') !== expected.join('\n')) {
        throw new Error(`${chapterPath}: CreatePostDto.${field} must use @IsDefined() exactly once on its canonical active line.`);
      }
    }
    const canonicalExample = [
      "import { IsBoolean, IsDefined, IsOptional, IsString, MinLength } from '@fluojs/validation';",
      '',
      'export class CreatePostDto {',
      "  @IsDefined()\n  @IsString()\n  @MinLength(3)\n  title = '';",
      '',
      "  @IsDefined()\n  @IsString()\n  @MinLength(10)\n  body = '';",
      '',
      '  @IsOptional()\n  @IsBoolean()\n  published?: boolean;',
      '}\n',
    ].join('\n');
    if (examples.length !== 1 || example !== canonicalExample) {
      throw new Error(`${chapterPath}: CreatePostDto example must match the canonical code exactly once.`);
    }

    const parityPath = `docs/contracts/nestjs-parity-gaps${locale}.md`;
    const lines = sectionLines(readText(parityPath), '## Not Implemented', parityPath);
    const canonicalRow = stabilityRows[locale];
    const matches = lines.filter((line) => line === canonicalRow).length;
    const extraClaims = lines.filter((line) => line !== canonicalRow && (
      line.includes('`@fluojs/validation`')
      || line.includes('docs/contracts/release-governance.md')
      || line.includes(canonicalRow.split('|')[1].trim())
    ));
    if (matches !== 1 || extraClaims.length > 0) {
      throw new Error(`${parityPath}: stability row must match the canonical line exactly once; found ${matches} canonical rows and ${extraClaims.length} noncanonical claims.`);
    }
  }
}
