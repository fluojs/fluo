import { DIAGNOSTIC_CODES } from './types.js';
import { createMalformedDiagnostic, createMissingEntryDiagnostic } from './diagnostics.js';
import type {
  EntryResolveResult,
  EntryRole,
  ManifestEntryParseResult,
  ManifestEntryReader,
  ManifestParseResult,
  ParsedManifest,
  ParsedManifestEntry,
  ReactViteManifestDiagnostic,
  UnknownRecord,
} from './types.js';

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readOwnValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function readOptionalString(reader: ManifestEntryReader, field: string): string | undefined {
  const value = readOwnValue(reader.entry, field);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  reader.diagnostics.push(
    createMalformedDiagnostic(
      `React Vite manifest entry "${reader.entryId}" field "${field}" must be a string.`,
      `${reader.entryId}.${field}`,
    ),
  );
  return undefined;
}

function readOptionalBoolean(reader: ManifestEntryReader, field: string): boolean | undefined {
  const value = readOwnValue(reader.entry, field);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  reader.diagnostics.push(
    createMalformedDiagnostic(
      `React Vite manifest entry "${reader.entryId}" field "${field}" must be a boolean.`,
      `${reader.entryId}.${field}`,
    ),
  );
  return undefined;
}

function readOptionalStringArray(reader: ManifestEntryReader, field: string): readonly string[] {
  const value = readOwnValue(reader.entry, field);

  if (value === undefined) {
    return [];
  }

  if (isStringArray(value)) {
    return [...value];
  }

  reader.diagnostics.push(
    createMalformedDiagnostic(
      `React Vite manifest entry "${reader.entryId}" field "${field}" must be an array of strings.`,
      `${reader.entryId}.${field}`,
    ),
  );
  return [];
}

function parseManifestEntry(entryId: string, rawEntry: unknown): ManifestEntryParseResult {
  if (!isUnknownRecord(rawEntry)) {
    return {
      diagnostics: [
        createMalformedDiagnostic(`React Vite manifest entry "${entryId}" must be an object.`, entryId),
      ],
    };
  }

  const diagnostics: ReactViteManifestDiagnostic[] = [];
  const reader = { diagnostics, entry: rawEntry, entryId };
  const fileValue = readOwnValue(rawEntry, 'file');
  const file = typeof fileValue === 'string' ? fileValue : '';

  if (typeof fileValue !== 'string') {
    diagnostics.push(
      createMalformedDiagnostic(
        `React Vite manifest entry "${entryId}" field "file" must be a string.`,
        `${entryId}.file`,
      ),
    );
  }

  const assets = readOptionalStringArray(reader, 'assets');
  const css = readOptionalStringArray(reader, 'css');
  const imports = readOptionalStringArray(reader, 'imports');
  const isDynamicEntry = readOptionalBoolean(reader, 'isDynamicEntry');
  const isEntry = readOptionalBoolean(reader, 'isEntry');
  const name = readOptionalString(reader, 'name');
  const src = readOptionalString(reader, 'src');

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    diagnostics: [],
    entry: {
      assets,
      css,
      file,
      id: entryId,
      imports,
      ...(isDynamicEntry !== undefined ? { isDynamicEntry } : {}),
      ...(isEntry !== undefined ? { isEntry } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(src !== undefined ? { src } : {}),
    },
  };
}

/**
 * Parses unknown Vite manifest data into a typed manifest map.
 *
 * @param value Manifest value loaded at a trust boundary.
 * @returns Parsed manifest data or malformed-manifest diagnostics.
 */
export function parseReactViteBuildManifest(value: unknown): ManifestParseResult {
  if (!isUnknownRecord(value)) {
    return {
      diagnostics: [createMalformedDiagnostic('React Vite manifest must be an object keyed by entry id.')],
      ok: false,
    };
  }

  const diagnostics: ReactViteManifestDiagnostic[] = [];
  const manifest: Record<string, ParsedManifestEntry> = {};
  Object.setPrototypeOf(manifest, null);

  for (const [entryId, rawEntry] of Object.entries(value)) {
    const parsed = parseManifestEntry(entryId, rawEntry);
    diagnostics.push(...parsed.diagnostics);

    if (parsed.entry !== undefined) {
      manifest[entryId] = parsed.entry;
    }
  }

  if (diagnostics.length > 0) {
    return { diagnostics, ok: false };
  }

  return { manifest, ok: true };
}

/**
 * Resolves a React server or client entry by manifest key, `src`, or `name`.
 *
 * @param manifest Parsed Vite manifest.
 * @param role React entry role being resolved.
 * @param entryId Requested manifest key, `src`, or `name`.
 * @returns The resolved manifest entry or role-specific diagnostics.
 */
export function resolveManifestEntry(
  manifest: ParsedManifest,
  role: EntryRole,
  entryId: string,
): EntryResolveResult {
  const exactEntry = readOwnValue(manifest, entryId);

  if (exactEntry !== undefined) {
    return { diagnostics: [], entry: exactEntry };
  }

  const matches = Object.values(manifest).filter((entry) => entry.src === entryId || entry.name === entryId);

  if (matches.length === 1) {
    return { diagnostics: [], entry: matches[0] };
  }

  if (matches.length > 1) {
    return {
      diagnostics: [
        {
          code: DIAGNOSTIC_CODES.unsupportedOutputShape,
          entry: entryId,
          message: `React Vite ${role} entry "${entryId}" matched multiple manifest entries.`,
        },
      ],
    };
  }

  return { diagnostics: [createMissingEntryDiagnostic(role, entryId)] };
}
