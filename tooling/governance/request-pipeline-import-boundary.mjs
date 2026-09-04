import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const coreInternalSpecifier = '@fluojs/core/internal';
const coreRequestPipelineSpecifier = '@fluojs/core/request-pipeline';

/**
 * Reader and writer names owned by the `@fluojs/core/request-pipeline` seam.
 *
 * First-party request-pipeline consumers must reach these through the dedicated
 * subpath instead of the broader `@fluojs/core/internal` surface.
 */
const requestPipelineSeamSymbols = [
  'appendClassValidationRule',
  'appendDtoFieldValidationRule',
  'defineDtoFieldBindingMetadata',
  'getClassValidationRules',
  'getDtoBindingSchema',
  'getDtoFieldBindingMetadata',
  'getDtoFieldValidationRules',
  'getDtoValidationSchema',
];

/**
 * First-party sources that perform DTO validation or binding metadata reads.
 */
const requestPipelineConsumerSourcePaths = [
  'packages/graphql/src/pipeline/input-pipeline.ts',
  'packages/http/src/adapters/dto-binding-plan.ts',
  'packages/openapi/src/schema-builder.ts',
  'packages/validation/src/internal/dto-metadata-cache.ts',
  'packages/validation/src/mapped-types.ts',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Request-pipeline import boundary check failed: ${message}`);
  }
}

function defaultReadText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function collectImportClauses(source, specifier) {
  const pattern = new RegExp(String.raw`import\s+([^;]*?)\s+from\s+['"]${specifier}['"]\s*;`, 'gu');
  const clauses = [];
  let match = pattern.exec(source);

  while (match) {
    clauses.push(match[1]);
    match = pattern.exec(source);
  }

  return clauses;
}

function collectNamedImports(clause) {
  const braceStart = clause.indexOf('{');
  const braceEnd = clause.lastIndexOf('}');

  if (braceStart === -1 || braceEnd <= braceStart) {
    return [];
  }

  return clause
    .slice(braceStart + 1, braceEnd)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^type\s+/u, '').split(/\s+as\s+/u)[0].trim())
    .filter(Boolean);
}

function collectImportedNames(source, specifier) {
  return collectImportClauses(source, specifier).flatMap((clause) => collectNamedImports(clause));
}

/**
 * Enforce that first-party request-pipeline consumers read DTO validation and
 * binding metadata through `@fluojs/core/request-pipeline`.
 *
 * @param readText Optional source reader used to inject governance fixtures.
 */
export function enforceRequestPipelineImportBoundary(readText = defaultReadText) {
  const seamSymbols = new Set(requestPipelineSeamSymbols);

  for (const relativePath of requestPipelineConsumerSourcePaths) {
    const source = readText(relativePath);
    const leakedSymbols = collectImportedNames(source, coreInternalSpecifier).filter((name) => seamSymbols.has(name));

    assert(
      leakedSymbols.length === 0,
      `${relativePath} must import ${leakedSymbols.join(', ')} from ${coreRequestPipelineSpecifier} instead of ${coreInternalSpecifier}.`,
    );

    const seamImports = collectImportedNames(source, coreRequestPipelineSpecifier).filter((name) => seamSymbols.has(name));

    assert(
      seamImports.length > 0,
      `${relativePath} must keep reading DTO validation or binding metadata through ${coreRequestPipelineSpecifier}.`,
    );
  }
}
