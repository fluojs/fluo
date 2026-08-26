const ENTITY_TAG_PATTERN = /^(W\/)?"([\u0021\u0023-\u007e\u0080-\u00ff]*)"$/;
const TEXT_ENCODER = new TextEncoder();

/** Parsed entity-tag value and its comparison strength. */
export interface ParsedEntityTag {
  readonly opaqueTag: string;
  readonly weak: boolean;
}

/** Parsed wildcard or concrete entity-tag list from a conditional request header. */
export type ParsedEntityTagList =
  | { readonly kind: 'any' }
  | { readonly kind: 'tags'; readonly tags: readonly ParsedEntityTag[] };

/**
 * Parse one entity tag in HTTP quoted-string syntax.
 *
 * @param value Header value to parse.
 * @returns The parsed tag, or `undefined` when the value is invalid.
 */
export function parseEntityTag(value: string | undefined): ParsedEntityTag | undefined {
  if (value === undefined) {
    return undefined;
  }

  const match = ENTITY_TAG_PATTERN.exec(value.trim());
  const opaqueTag = match?.[2];

  return opaqueTag === undefined
    ? undefined
    : {
        opaqueTag,
        weak: match?.[1] !== undefined,
      };
}

/**
 * Parse a comma-separated HTTP entity-tag list.
 *
 * @param value Header value to parse.
 * @returns The parsed list, or `undefined` when a nonempty member is invalid.
 */
export function parseEntityTagList(value: string | undefined): ParsedEntityTagList | undefined {
  const input = value?.trim();

  if (!input) {
    return undefined;
  }

  if (input === '*') {
    return { kind: 'any' };
  }

  const tags: ParsedEntityTag[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    while (input[cursor] === ' ' || input[cursor] === '\t') {
      cursor += 1;
    }

    if (input[cursor] === ',') {
      cursor += 1;
      continue;
    }

    const weak = input.startsWith('W/', cursor);
    if (weak) {
      cursor += 2;
    }

    if (input[cursor] !== '"') {
      return undefined;
    }

    const start = cursor;
    cursor += 1;

    while (cursor < input.length && input[cursor] !== '"') {
      cursor += 1;
    }

    if (cursor >= input.length) {
      return undefined;
    }

    cursor += 1;
    const parsed = parseEntityTag(`${weak ? 'W/' : ''}${input.slice(start, cursor)}`);

    if (parsed === undefined) {
      return undefined;
    }

    tags.push(parsed);

    while (input[cursor] === ' ' || input[cursor] === '\t') {
      cursor += 1;
    }

    if (cursor === input.length) {
      break;
    }

    if (input[cursor] !== ',') {
      return undefined;
    }

    cursor += 1;
  }

  return tags.length === 0 ? undefined : { kind: 'tags', tags };
}

/**
 * Compare a current entity tag with conditional request candidates.
 *
 * @param current Current representation tag.
 * @param candidates Parsed request candidates.
 * @param exists Whether a current representation exists.
 * @param comparison Required strong or weak comparison mode.
 * @returns Whether a candidate matches the current representation.
 */
export function matchesEntityTag(
  current: ParsedEntityTag | undefined,
  candidates: ParsedEntityTagList,
  exists: boolean,
  comparison: 'strong' | 'weak',
): boolean {
  if (candidates.kind === 'any') {
    return exists;
  }

  if (!exists || current === undefined) {
    return false;
  }

  return candidates.tags.some((candidate) => {
    if (comparison === 'strong' && (current.weak || candidate.weak)) {
      return false;
    }

    return current.opaqueTag === candidate.opaqueTag;
  });
}

/**
 * Generate a SHA-256 entity tag for a serializable response body.
 *
 * @param value Response value to serialize.
 * @param contentType Selected response content type.
 * @param mode Requested entity-tag strength.
 * @param isSerialized Whether `value` already contains its final serialized representation.
 * @returns The generated entity tag, or `undefined` when no bytes can be serialized.
 */
export async function generateEntityTag(
  value: unknown,
  contentType: string | undefined,
  mode: 'strong' | 'weak',
  isSerialized = false,
): Promise<string | undefined> {
  const bytes = serializeEntityTagValue(value, contentType, isSerialized);

  if (bytes === undefined) {
    return undefined;
  }

  const digestInput = Uint8Array.from(bytes).buffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', digestInput));
  let hex = '';

  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return `${mode === 'weak' ? 'W/' : ''}"sha256-${hex}"`;
}

function serializeEntityTagValue(
  value: unknown,
  contentType: string | undefined,
  isSerialized: boolean,
): Uint8Array | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (typeof value === 'string' && (isSerialized || !isJsonContentType(contentType))) {
    return TEXT_ENCODER.encode(value);
  }

  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : TEXT_ENCODER.encode(serialized);
}

function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }

  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}
