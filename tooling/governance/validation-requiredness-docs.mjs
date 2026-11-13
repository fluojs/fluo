import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function defaultReadText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/**
 * Keep required-string examples and validation release claims aligned with
 * the missing-value and Official-tier contracts in both documentation locales.
 *
 * @param readText Optional reader for mutation fixtures.
 */
export function enforceValidationRequirednessDocs(readText = defaultReadText) {
  const major = JSON.parse(readText('packages/validation/package.json')).version.split('.')[0];

  for (const locale of ['', '.ko']) {
    const chapterPath = `book/beginner/ch06-validation${locale}.md`;
    const chapter = readText(chapterPath);
    const example = [...chapter.matchAll(/^```(?:typescript|ts)\n([\s\S]*?)^```/gmu)]
      .map((match) => match[1])
      .find((source) => source.includes('export class CreatePostDto'));
    const imports = example?.match(/import\s*\{([^}]+)\}\s*from\s*['"]@fluojs\/validation['"]/u);

    if (!imports?.[1].split(',').some((name) => name.trim() === 'IsDefined')) {
      throw new Error(`${chapterPath}: CreatePostDto must import IsDefined from @fluojs/validation.`);
    }

    for (const field of ['title', 'body']) {
      const declaration = example.match(new RegExp(
        String.raw`((?:\s*@\w+\([^)]*\)\s*)+)${field}\s*=\s*'';`,
        'u',
      ));
      if (!declaration || !/@IsDefined\(\)/u.test(declaration[1])) {
        throw new Error(`${chapterPath}: CreatePostDto.${field} must use @IsDefined().`);
      }
    }

    const parityPath = `docs/contracts/nestjs-parity-gaps${locale}.md`;
    for (const claim of readText(parityPath).matchAll(/`@fluojs\/validation`[^|\n]*?`(\d+)\.x`/gu)) {
      if (claim[1] !== major) {
        throw new Error(`${parityPath}: validation major ${claim[1]}.x disagrees with package major ${major}.x.`);
      }
    }
  }
}
