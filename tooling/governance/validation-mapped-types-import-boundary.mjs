import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const validationRootSpecifier = '@fluojs/validation';
const validationMappedTypesSpecifier = '@fluojs/validation/mapped-types';
const mappedTypeHelpers = new Set(['IntersectionType', 'OmitType', 'PartialType', 'PickType']);

const governedPaths = [
  'packages/http/src/decorators.test.ts',
  'packages/http/src/dispatch/dispatcher.test.ts',
  'packages/openapi/src/openapi-module.test.ts',
  'packages/validation/README.md',
  'packages/validation/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  'apps/docs/content/docs/guides/validation-serialization.mdx',
  'book/beginner/ch06-validation.md',
  'book/beginner/ch06-validation.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
];

function defaultReadText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function collectRootMappedTypeImports(source) {
  const imports = [];
  const pattern = new RegExp(String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]${validationRootSpecifier}['"]`, 'gu');
  let match = pattern.exec(source);

  while (match) {
    const helpers = match[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0].trim())
      .filter((entry) => mappedTypeHelpers.has(entry));

    if (helpers.length > 0) {
      imports.push(...helpers);
    }

    match = pattern.exec(source);
  }

  return imports;
}

/**
 * Reject mapped helper imports from the validation root in TypeScript source
 * and Markdown/MDX code fences.
 *
 * @param source Source text or documentation text to inspect.
 * @param sourcePath Repository-relative path used in diagnostic output.
 */
export function enforceNoRootMappedTypeImports(source, sourcePath) {
  const rootMappedImports = collectRootMappedTypeImports(source);

  if (rootMappedImports.length > 0) {
    throw new Error(
      `${sourcePath} must import ${rootMappedImports.join(', ')} from ${validationMappedTypesSpecifier}, not ${validationRootSpecifier}.`,
    );
  }
}

/**
 * Enforce canonical mapped-type imports and the validation metadata preload
 * and mapped constructor/default guidance in the EN/KO owner documents.
 *
 * @param readText Optional source reader used to inject governance fixtures.
 */
export function enforceValidationMappedTypesImportBoundary(readText = defaultReadText) {
  for (const relativePath of governedPaths) {
    const source = readText(relativePath);
    enforceNoRootMappedTypeImports(source, relativePath);

    if (
      relativePath.startsWith('packages/validation/README')
      || relativePath.startsWith('docs/getting-started/migrate-from-nestjs')
    ) {
      const korean = relativePath.endsWith('.ko.md');
      const readme = relativePath.startsWith('packages/');
      const metadataHeading = readme
        ? korean ? '## 빠른 시작' : '## Quick Start'
        : korean ? '## Decorator metadata 사전 로드 순서' : '## Decorator metadata preload ordering';
      const metadata = (source.split(metadataHeading)[1]?.split('```')[0] ?? '').replace(/\s+/gu, ' ');
      const metadataOrdering = korean
        ? /평가되기 전에 `Symbol\.metadata`/u
        : /`Symbol\.metadata` (?:must exist before|before)/u;
      if (
        !metadata.includes('`@fluojs/validation`')
        || !metadata.includes('`@ValidateClass(...)`')
        || !metadataOrdering.test(metadata)
      ) {
        throw new Error(`${relativePath} must document validation metadata preload before decorated DTO modules evaluate.`);
      }

      const mappedHeading = readme
        ? korean ? '### Mapped DTO 헬퍼' : '### Mapped DTO helpers'
        : '### Nested DTO and Mapped Type Rewrites';
      const mapped = (source.split(mappedHeading)[1]?.split('\n### ')[0] ?? '').replace(/\s+/gu, ' ');
      const mappedDefaults = korean
        ? /`PickType`, `OmitType`, `IntersectionType`은 source DTO 생성자를 실행하거나 field initializer\/default 값을 복사하지 않습니다/u
        : /`PickType`, `OmitType`, and `IntersectionType` do not run source DTO constructors or copy field initializer\/default values/u;
      if (!mappedDefaults.test(mapped)) {
        throw new Error(`${relativePath} must document validation mapped DTO constructor/default boundaries.`);
      }
    }
  }
}
