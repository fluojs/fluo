import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  enforceNoRootMappedTypeImports,
  enforceValidationMappedTypesImportBoundary,
} from './validation-mapped-types-import-boundary.mjs';

describe('validation mapped-type import boundary governance', () => {
  it('keeps governed source and documentation examples on the canonical subpath', () => {
    expect(() => enforceValidationMappedTypesImportBoundary()).not.toThrow();
  });

  it('rejects mapped helper imports from the validation package root in source', () => {
    expect(() => enforceNoRootMappedTypeImports(
      "import { PickType } from '@fluojs/validation';",
      'packages/http/src/users.ts',
    )).toThrow(/packages\/http\/src\/users\.ts.*@fluojs\/validation\/mapped-types/u);
  });

  it('rejects mapped helper imports from the validation package root in code fences', () => {
    expect(() => enforceNoRootMappedTypeImports(
      "```ts\nimport { OmitType as PublicUser } from '@fluojs/validation';\n```",
      'docs/getting-started/migrate-from-nestjs.md',
    )).toThrow(/docs\/getting-started\/migrate-from-nestjs\.md.*OmitType/u);
  });

  for (const sourcePath of [
    'packages/validation/README.md',
    'packages/validation/README.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
  ]) {
    const korean = sourcePath.endsWith('.ko.md');
    const readme = sourcePath.startsWith('packages/');
    const headings = [
      readme
        ? korean ? '## 빠른 시작' : '## Quick Start'
        : korean ? '## Decorator metadata 사전 로드 순서' : '## Decorator metadata preload ordering',
      readme
        ? korean ? '### Mapped DTO 헬퍼' : '### Mapped DTO helpers'
        : '### Nested DTO and Mapped Type Rewrites',
    ];

    for (const [index, heading] of headings.entries()) {
      const source = readFileSync(join(import.meta.dirname, '../..', sourcePath), 'utf8');
      const section = source.slice(source.indexOf(`${heading}\n`) + heading.length + 1);
      const statement = section.split('\n\n').find((paragraph) => index === 0
        ? paragraph.includes('Symbol.metadata')
        : paragraph.includes('source DTO'))?.trim();
      if (!statement) {
        throw new Error(`Missing canonical fixture for ${sourcePath}: ${heading}`);
      }
      const diagnostic = index === 0
        ? 'metadata preload before decorated DTO modules evaluate.'
        : 'mapped DTO constructor/default boundaries.';
      const prefix = korean ? '다음 설명은 틀렸습니다: ' : 'It is incorrect that ';
      const reworded = korean
        ? '이 DTO 안내는 다른 순서로 다시 서술되었습니다.'
        : 'This DTO guidance has been restated in a different order.';

      it.each([
        ['missing', ''],
        ['duplicated', `${statement}\n\n${statement}`],
        ['negated-prefix', `${prefix}${statement}`],
        ['reordered', statement.split(' ').reverse().join(' ')],
        ['reworded', reworded],
        ['commented-out', `<!-- ${statement} -->`],
        ['commented-out-lines', statement.split('\n').map((line) => `// ${line}`).join('\n')],
        ['additional-negation', `${statement}\n\n${prefix}${statement}`],
        ['additional-rewording', `${statement}\n\n${reworded}`],
      ])(`rejects %s canonical statement for ${heading} in ${sourcePath}`, (mutation, replacement) => {
        const readText = (relativePath: string) => {
          const text = readFileSync(join(import.meta.dirname, '../..', relativePath), 'utf8');
          return relativePath === sourcePath ? text.replace(statement, replacement) : text;
        };

        const detail = mutation === 'missing' || mutation === 'duplicated'
          ? ` Expected exactly one canonical line in ${heading}; found ${mutation === 'missing' ? 0 : 2}:`
          : '';

        expect(() => enforceValidationMappedTypesImportBoundary(readText))
          .toThrow(`${sourcePath} must document validation ${diagnostic}${detail}`);
      });

      it(`rejects commented-out example code for ${heading} in ${sourcePath}`, () => {
        const codeLine = index === 0 ? 'ensureMetadataSymbol();' : '  @IsString()';
        expect(section).toContain(`\n${codeLine}`);
        const readText = (relativePath: string) => {
          const text = readFileSync(join(import.meta.dirname, '../..', relativePath), 'utf8');
          if (relativePath !== sourcePath) {
            return text;
          }
          const start = text.indexOf(`${heading}\n`) + heading.length + 1;
          return text.slice(0, start) + text.slice(start).replace(codeLine, `// ${codeLine}`);
        };

        expect(() => enforceValidationMappedTypesImportBoundary(readText))
          .toThrow(`${sourcePath} must document validation ${diagnostic} Section ${heading} differs from canonical guidance`);
      });
    }

    for (const heading of headings) {
      it.each([
        ['missing', ''],
        ['level-changed', `#${heading}`],
        ['inline', `See ${heading}`],
        ['suffixed', `${heading} extra`],
        ['duplicated', heading],
      ])(`rejects %s heading ${heading} in ${sourcePath}`, (mutation, replacement) => {
        const readText = (relativePath: string) => {
          const source = readFileSync(join(import.meta.dirname, '../..', relativePath), 'utf8');
          if (relativePath !== sourcePath) {
            return source;
          }
          return mutation === 'duplicated'
            ? `${source}\n\n${heading}\n\nContrary guidance.`
            : source.replace(heading, replacement);
        };

        expect(() => enforceValidationMappedTypesImportBoundary(readText))
          .toThrow(`${sourcePath} must contain exactly one line-exact heading: ${heading}`);
      });
    }

    it(`rejects negated metadata preload requirements in ${sourcePath}`, () => {
      const [before, after] = korean
        ? readme
          ? ['`Symbol.metadata`가 있어야 합니다.', '`Symbol.metadata`가 없어도 됩니다.']
          : ['`Symbol.metadata`가 필요합니다.', '`Symbol.metadata`가 필요하지 않습니다.']
        : readme
          ? ['`Symbol.metadata` must exist before', '`Symbol.metadata` need not exist before']
          : ['need `Symbol.metadata` before', 'do not need `Symbol.metadata` before'];
      const readText = (relativePath: string) => {
        const source = readFileSync(join(import.meta.dirname, '../..', relativePath), 'utf8');
        if (relativePath !== sourcePath) {
          return source;
        }
        expect(source).toContain(before);
        return source.replace(before, after);
      };

      expect(() => enforceValidationMappedTypesImportBoundary(readText))
        .toThrow(`${sourcePath} must document validation metadata preload before decorated DTO modules evaluate.`);
    });

    it.each([
      ['metadata preload', '`@fluojs/validation`', '`validation`'],
      ['source constructors', 'do not run source DTO constructors', 'run source DTO constructors'],
      ['field defaults', 'or copy field initializer/default values', 'and copy field initializer/default values'],
    ])(`rejects %s guidance mutations in ${sourcePath}`, (boundary, before, after) => {
      const korean = sourcePath.endsWith('.ko.md');
      const replacements = korean && boundary !== 'metadata preload'
        ? boundary === 'source constructors'
          ? ['source DTO 생성자를 실행하거나', 'source DTO 생성자를 실행하고']
          : ['field initializer/default 값을 복사하지 않습니다', 'field initializer/default 값을 복사합니다']
        : [before, after];
      const readText = (relativePath: string) => {
        const source = readFileSync(join(import.meta.dirname, '../..', relativePath), 'utf8');
        return relativePath === sourcePath
          ? source.replaceAll(replacements[0], replacements[1])
          : source;
      };

      const diagnostic = boundary === 'metadata preload'
        ? 'metadata preload'
        : 'mapped DTO constructor/default boundaries';

      expect(() => enforceValidationMappedTypesImportBoundary(readText))
        .toThrow(`${sourcePath} must document validation ${diagnostic}`);
    });
  }
});
