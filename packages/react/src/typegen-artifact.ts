import type { ReactPageCatalogEntry } from './page-catalog.js';

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

export function parseGeneratedReactPageCatalog(source: string): readonly ReactPageCatalogEntry[] | undefined {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const paths = parsePaths(lines);
  const paramsById = parseParams(lines);
  if (paths === undefined || paramsById === undefined || paths.size !== paramsById.size) {
    return undefined;
  }

  const catalog: ReactPageCatalogEntry[] = [];
  for (const [id, path] of paths) {
    const params = paramsById.get(id);
    if (params === undefined) {
      return undefined;
    }
    catalog.push({ handler: '', id, kind: 'react-page', method: 'GET', params, path, router: '' });
  }
  return catalog;
}
