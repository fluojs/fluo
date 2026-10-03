import { parseReactJsonShape, type ReactJsonShape, type ReactQueryField } from './typegen-projection.js';

/** Compiler projection of one existing native HTTP form handler. */
export type ReactFormTypeProjection = {
  readonly id: string;
  readonly path: string;
  readonly params: readonly string[];
  readonly input: readonly ReactQueryField[];
  readonly data?: ReactJsonShape;
  readonly dataOptional?: true;
};

/** Browser-only module props and existing form contracts emitted by the same typegen lifecycle. */
export type ReactTypegenContracts = {
  readonly sourceFingerprint?: string;
  readonly modules: Readonly<Record<string, ReactJsonShape>>;
  readonly forms: readonly ReactFormTypeProjection[];
};

const PREFIX = '// fluo-typegen-contracts ';

/**
 * Encode standalone compiler contracts as one deterministic machine-consumed artifact line.
 *
 * @param contracts Supported module and form projections.
 * @returns The canonical metadata line.
 */
export function renderReactTypegenContracts(contracts: ReactTypegenContracts): string {
  return `${PREFIX}${JSON.stringify(contracts)}`;
}

/**
 * Parse the optional compiler contracts carried by a generated artifact.
 *
 * @param source Complete generated source.
 * @returns Valid contracts, no contracts, or `null` for malformed metadata.
 */
export function parseReactTypegenContracts(source: string): ReactTypegenContracts | undefined | null {
  const line = source.split('\n').find((entry) => entry.startsWith(PREFIX));
  if (line === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(PREFIX.length));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (typeof value !== 'object' || value === null || !('modules' in value) || !('forms' in value)
    || typeof value.modules !== 'object' || value.modules === null || Array.isArray(value.modules) || !Array.isArray(value.forms)) return null;
  const modules: Record<string, ReactJsonShape> = {};
  const sourceFingerprint = 'sourceFingerprint' in value ? value.sourceFingerprint : undefined;
  if (sourceFingerprint !== undefined && (typeof sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(sourceFingerprint))) return null;
  for (const [id, raw] of Object.entries(value.modules)) {
    const shape = parseReactJsonShape(raw);
    if (shape === undefined) return null;
    Object.defineProperty(modules, id, { enumerable: true, value: shape });
  }
  const forms: ReactFormTypeProjection[] = [];
  for (const form of value.forms) {
    if (typeof form !== 'object' || form === null || !('id' in form) || typeof form.id !== 'string'
      || !('path' in form) || typeof form.path !== 'string' || !('params' in form) || !Array.isArray(form.params)
      || !form.params.every((param: unknown) => typeof param === 'string') || !('input' in form) || !Array.isArray(form.input)) return null;
    const input: ReactQueryField[] = [];
    for (const field of form.input) {
      if (typeof field !== 'object' || field === null || !('property' in field) || typeof field.property !== 'string'
        || !('wire' in field) || typeof field.wire !== 'string' || !('optional' in field) || typeof field.optional !== 'boolean' || !('shape' in field)) return null;
      const shape = parseReactJsonShape(field.shape);
      if (shape === undefined) return null;
      input.push({ property: field.property, wire: field.wire, optional: field.optional, shape });
    }
    const data = 'data' in form ? parseReactJsonShape(form.data) : undefined;
    if ('data' in form && data === undefined) return null;
    if ('dataOptional' in form && form.dataOptional !== true) return null;
    forms.push({ id: form.id, path: form.path, params: form.params, input, ...(data === undefined ? {} : { data }),
      ...('dataOptional' in form ? { dataOptional: true as const } : {}) });
  }
  return { modules, forms, ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }) };
}
