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
 * Enforce the canonical mapped-type import boundary for governed source and
 * documentation examples.
 *
 * @param readText Optional source reader used to inject governance fixtures.
 */
export function enforceValidationMappedTypesImportBoundary(readText = defaultReadText) {
  for (const relativePath of governedPaths) {
    enforceNoRootMappedTypeImports(readText(relativePath), relativePath);
  }
}
