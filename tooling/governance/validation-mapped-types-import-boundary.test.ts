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
