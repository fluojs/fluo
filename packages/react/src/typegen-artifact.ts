import type { ReactPageCatalogEntry } from './page-catalog.js';
import { parseReactJsonShape, type ReactQueryField } from './typegen-projection.js';

const JSON_STRING_SOURCE = '"(?:\\\\.|[^"\\\\])*"';
const PATH_LINE_PATTERN = new RegExp(`^  readonly (${JSON_STRING_SOURCE}): (${JSON_STRING_SOURCE});$`, 'u');
const PARAM_OPEN_PATTERN = new RegExp(`^  readonly (${JSON_STRING_SOURCE}): \\{$`, 'u');
const PARAM_LINE_PATTERN = new RegExp(`^    readonly (${JSON_STRING_SOURCE}): string;$`, 'u');
const PARAM_UNDEFINED_PATTERN = new RegExp(`^  readonly (${JSON_STRING_SOURCE}): undefined;$`, 'u');

function parseJsonString(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readSection(lines: readonly string[], opening: string, closing: string): readonly string[] | undefined {
  const start = lines.indexOf(opening);
  if (start < 0) {
    return undefined;
  }
  const end = lines.indexOf(closing, start + 1);
  return end < 0 ? undefined : lines.slice(start + 1, end);
}

function parsePaths(lines: readonly string[]): ReadonlyMap<string, string> | undefined {
  if (lines.includes('export type ReactPagePathById = Readonly<Record<never, never>>;')) {
    return new Map();
  }
  const section = readSection(lines, 'export interface ReactPagePathById {', '}');
  if (section === undefined || section.length === 0) {
    return undefined;
  }
  const paths = new Map<string, string>();
  for (const line of section) {
    const match = PATH_LINE_PATTERN.exec(line);
    const id = match?.[1] === undefined ? undefined : parseJsonString(match[1]);
    const path = match?.[2] === undefined ? undefined : parseJsonString(match[2]);
    if (id === undefined || path === undefined || paths.has(id)) {
      return undefined;
    }
    paths.set(id, path);
  }
  return paths;
}

function parseParams(lines: readonly string[]): ReadonlyMap<string, readonly string[]> | undefined {
  if (lines.includes('export type ReactPageParamsById = Readonly<Record<never, never>>;')) {
    return new Map();
  }
  const section = readSection(lines, 'export interface ReactPageParamsById {', '}');
  if (section === undefined || section.length === 0) {
    return undefined;
  }
  const paramsById = new Map<string, readonly string[]>();
  for (let index = 0; index < section.length; index += 1) {
    const line = section[index] ?? '';
    const undefinedMatch = PARAM_UNDEFINED_PATTERN.exec(line);
    const undefinedId = undefinedMatch?.[1] === undefined ? undefined : parseJsonString(undefinedMatch[1]);
    if (undefinedId !== undefined) {
      if (paramsById.has(undefinedId)) {
        return undefined;
      }
      paramsById.set(undefinedId, []);
      continue;
    }

    const openMatch = PARAM_OPEN_PATTERN.exec(line);
    const id = openMatch?.[1] === undefined ? undefined : parseJsonString(openMatch[1]);
    if (id === undefined || paramsById.has(id)) {
      return undefined;
    }
    const params: string[] = [];
    index += 1;
    while (index < section.length && section[index] !== '  };') {
      const paramMatch = PARAM_LINE_PATTERN.exec(section[index] ?? '');
      const param = paramMatch?.[1] === undefined ? undefined : parseJsonString(paramMatch[1]);
      if (param === undefined) {
        return undefined;
      }
      params.push(param);
      index += 1;
    }
    if (section[index] !== '  };' || params.length === 0) {
      return undefined;
    }
    paramsById.set(id, params);
  }
  return paramsById;
}

/**
 * Parses the route catalog encoded in one canonical generated React page artifact.
 *
 * @param source Generated artifact source to inspect.
 * @returns Parsed catalog entries, or `undefined` when the artifact body is malformed.
 */
export function parseGeneratedReactPageCatalog(source: string): readonly ReactPageCatalogEntry[] | undefined {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const paths = parsePaths(lines);
  const paramsById = parseParams(lines);
  if (paths === undefined || paramsById === undefined || paths.size !== paramsById.size) {
    return undefined;
  }

  const catalog: ReactPageCatalogEntry[] = [];
  const projection = parseProjection(lines);
  if (projection === undefined) return undefined;
  for (const [id, path] of paths) {
    const params = paramsById.get(id);
    if (params === undefined) {
      return undefined;
    }
    catalog.push({ handler: '', id, kind: 'react-page', method: 'GET', params, path, router: '', ...projection.get(id) });
  }
  return catalog;
}

function parseProjection(lines: readonly string[]): ReadonlyMap<string, {
  readonly query?: readonly ReactQueryField[];
  readonly sourceFingerprint?: string;
}> | undefined {
  const prefix = '// fluo-type-projection ';
  const line = lines.find((entry) => entry.startsWith(prefix));
  const map = new Map<string, { readonly query?: readonly ReactQueryField[]; readonly sourceFingerprint?: string }>();
  if (line === undefined) return map;
  let entries: unknown;
  try {
    entries = JSON.parse(line.slice(prefix.length));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry) || typeof entry.id !== 'string' || map.has(entry.id)) return undefined;
    const sourceFingerprint = 'sourceFingerprint' in entry ? entry.sourceFingerprint : undefined;
    if (sourceFingerprint !== undefined && (typeof sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(sourceFingerprint))) return undefined;
    const query: ReactQueryField[] = [];
    if ('query' in entry) {
      if (!Array.isArray(entry.query)) return undefined;
      for (const field of entry.query) {
        if (typeof field !== 'object' || field === null || !('property' in field) || typeof field.property !== 'string'
          || !('wire' in field) || typeof field.wire !== 'string' || !('optional' in field) || typeof field.optional !== 'boolean'
          || !('shape' in field)) return undefined;
        const shape = parseReactJsonShape(field.shape);
        if (shape === undefined) return undefined;
        query.push({ property: field.property, wire: field.wire, optional: field.optional, shape });
      }
    }
    map.set(entry.id, {
      ...('query' in entry ? { query } : {}),
      ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
    });
  }
  return map;
}
