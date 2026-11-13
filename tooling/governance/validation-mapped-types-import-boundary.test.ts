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
