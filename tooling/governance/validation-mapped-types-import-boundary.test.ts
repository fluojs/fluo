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
});
