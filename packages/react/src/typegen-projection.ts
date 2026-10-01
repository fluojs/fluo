/** Supported JSON projection emitted by compiler tooling, never a server implementation. */
export type ReactJsonShape =
  | { readonly kind: 'string' | 'number' | 'boolean' | 'null' | 'json' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'array'; readonly item: ReactJsonShape }
  | { readonly kind: 'union'; readonly members: readonly ReactJsonShape[] }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, ReactJsonField>> };

/** Exact JSON-object property shape and omission policy. */
export type ReactJsonField = { readonly optional: boolean; readonly shape: ReactJsonShape };

/** One HTTP query binding; property and wire names remain separate. */
export type ReactQueryField = ReactJsonField & { readonly property: string; readonly wire: string };

/**
 * Render a supported JSON projection without importing server types.
 *
 * @param shape Validated tooling projection.
 * @returns The corresponding standalone TypeScript type expression.
 */
export function renderReactJsonType(shape: ReactJsonShape): string {
  switch (shape.kind) {
    case 'string':
    case 'number':
    case 'boolean':
      return shape.kind;
    case 'null':
      return 'null';
    case 'json':
      return 'ReactJsonValue';
    case 'literal':
      return JSON.stringify(shape.value);
    case 'array':
      return `readonly (${renderReactJsonType(shape.item)})[]`;
    case 'union':
      return shape.members.map(renderReactJsonType).join(' | ');
    case 'object':
      return `{ ${Object.entries(shape.fields).map(([key, field]) =>
        `readonly ${JSON.stringify(key)}${field.optional ? '?' : ''}: ${renderReactJsonType(field.shape)};`).join(' ')} }`;
    default: {
      const unreachable: never = shape;
      throw new TypeError(`Unsupported JSON shape ${String(unreachable)}.`);
    }
  }
}

/**
 * Parse serialized compiler shape metadata at the artifact boundary.
 *
 * @param value Untrusted metadata from an existing generated artifact.
 * @returns A supported shape, or `undefined` for malformed metadata.
 */
export function parseReactJsonShape(value: unknown): ReactJsonShape | undefined {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return undefined;
  switch (value.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'json':
      return { kind: value.kind };
    case 'literal':
      if ('value' in value && (typeof value.value === 'string' || typeof value.value === 'boolean'
        || (typeof value.value === 'number' && Number.isFinite(value.value)))) {
        return { kind: 'literal', value: value.value };
      }
      return undefined;
    case 'array': {
      const item = 'item' in value ? parseReactJsonShape(value.item) : undefined;
      return item === undefined ? undefined : { kind: 'array', item };
    }
    case 'union': {
      if (!('members' in value) || !Array.isArray(value.members) || value.members.length === 0) return undefined;
      const members: ReactJsonShape[] = [];
      for (const member of value.members) {
        const shape = parseReactJsonShape(member);
        if (shape === undefined) return undefined;
        members.push(shape);
      }
      return { kind: 'union', members };
    }
    case 'object': {
      if (!('fields' in value) || typeof value.fields !== 'object' || value.fields === null || Array.isArray(value.fields)) return undefined;
      const fields: Record<string, ReactJsonField> = {};
      for (const [key, field] of Object.entries(value.fields)) {
        if (typeof field !== 'object' || field === null || !('optional' in field)
          || typeof field.optional !== 'boolean' || !('shape' in field)) return undefined;
        const shape = parseReactJsonShape(field.shape);
        if (shape === undefined) return undefined;
        Object.defineProperty(fields, key, { enumerable: true, value: { optional: field.optional, shape } });
      }
      return { kind: 'object', fields };
    }
    default:
      return undefined;
  }
}
