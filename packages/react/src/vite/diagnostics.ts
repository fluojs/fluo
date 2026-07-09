import { DIAGNOSTIC_CODES, type EntryRole, type ParsedManifestEntry } from './types.js';
import type { ReactViteManifestDiagnostic } from './types.js';

/**
 * Creates a malformed-manifest diagnostic.
 *
 * @param message Human-readable explanation for the malformed manifest value.
 * @param path Optional manifest path for field-level failures.
 * @returns A diagnostic with the stable malformed-manifest code.
 */
export function createMalformedDiagnostic(
  message: string,
  path?: string,
): ReactViteManifestDiagnostic {
  return {
    code: DIAGNOSTIC_CODES.malformed,
    message,
    ...(path !== undefined ? { path } : {}),
  };
}

/**
 * Creates a missing-entry diagnostic for the requested React entry role.
 *
 * @param role React entry role being resolved.
 * @param entry Requested manifest key, `src`, or `name`.
 * @returns A diagnostic with the role-specific missing-entry code.
 */
export function createMissingEntryDiagnostic(
  role: EntryRole,
  entry: string,
): ReactViteManifestDiagnostic {
  return {
    code: role === 'server' ? DIAGNOSTIC_CODES.missingServerEntry : DIAGNOSTIC_CODES.missingClientEntry,
    entry,
    message: `React Vite ${role} entry "${entry}" was not found in the manifest.`,
  };
}

/**
 * Creates an unsupported-output diagnostic when a selected chunk is not JavaScript.
 *
 * @param role React entry role whose output shape was rejected.
 * @param entry Parsed manifest entry with the unsupported output file.
 * @returns A diagnostic with the stable unsupported-output code.
 */
export function createUnsupportedOutputDiagnostic(
  role: EntryRole,
  entry: ParsedManifestEntry,
): ReactViteManifestDiagnostic {
  return {
    code: DIAGNOSTIC_CODES.unsupportedOutputShape,
    entry: entry.id,
    message: `React Vite ${role} entry "${entry.id}" must resolve to a JavaScript output file, received "${entry.file}".`,
  };
}
