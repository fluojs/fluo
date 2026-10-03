import type { ReactTypegenContracts } from './typegen-contract.js';
import { type ReactJsonShape, renderReactJsonType } from './typegen-projection.js';

/**
 * Emit limited JSON decoders and existing form contracts without server imports.
 *
 * @param contracts Compiler-projected module props and form results.
 * @returns Standalone browser-safe TypeScript declarations and runtime decoders.
 */
export function renderReactContractRuntime(contracts: ReactTypegenContracts): readonly string[] {
  const lines = [
    "import type { ReactFormContract } from '@fluojs/react/client';",
    "import type {} from '@fluojs/react';",
    'export type ReactJsonValue = null | string | number | boolean | readonly ReactJsonValue[] | { readonly [key: string]: ReactJsonValue };',
  ];
  const shapes: ReactJsonShape[] = [];
  const indices = new Map<string, number>();
  const register = (shape: ReactJsonShape): number => {
    const key = JSON.stringify(shape);
    const previous = indices.get(key);
    if (previous !== undefined) return previous;
    const index = shapes.length;
    indices.set(key, index);
    shapes.push(shape);
    return index;
  };
  const modules = Object.entries(contracts.modules);
  modules.forEach(([, shape]) => { register(shape); });
  contracts.forms.forEach((form) => { if (form.data !== undefined) register(form.data); });
  const call = (shape: ReactJsonShape, value: string) => `accepts${register(shape)}(${value})`;
  const expression = (shape: ReactJsonShape): string => {
    switch (shape.kind) {
      case 'string': return "typeof value === 'string'";
      case 'number': return "typeof value === 'number' && Number.isFinite(value)";
      case 'boolean': return "typeof value === 'boolean'";
      case 'null': return 'value === null';
      case 'literal': return `value === ${JSON.stringify(shape.value)}`;
      case 'json': return 'isReactJsonValue(value)';
      case 'array': return `Array.isArray(value) && value.every((item: unknown) => ${call(shape.item, 'item')})`;
      case 'union': return shape.members.map((member) => call(member, 'value')).join(' || ');
      case 'object': {
        const checks = Object.entries(shape.fields).map(([key, field]) => {
          const literal = JSON.stringify(key);
          const present = `(${literal} in value && ${call(field.shape, `value[${literal}]`)})`;
          return field.optional ? `(!Object.hasOwn(value, ${literal}) || ${present})`
            : `(Object.hasOwn(value, ${literal}) && ${present})`;
        });
        return [
          "typeof value === 'object'", 'value !== null', '!Array.isArray(value)',
          '(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)',
          Object.keys(shape.fields).length === 0
            ? 'Object.keys(value).length === 0'
            : `Object.keys(value).every((key) => ${JSON.stringify(Object.keys(shape.fields))}.includes(key))`,
          ...checks,
        ].join(' && ');
      }
      default: {
        const unreachable: never = shape;
        throw new TypeError(`Unsupported JSON decoder ${String(unreachable)}.`);
      }
    }
  };
  for (let index = 0; index < shapes.length; index++) {
    const shape = shapes[index];
    lines.push(`function accepts${index}(value: unknown): value is ${renderReactJsonType(shape)} { return ${expression(shape)}; }`);
  }
  if (shapes.some((shape) => shape.kind === 'json')) {
    lines.push(
      'function isReactJsonValue(value: unknown, active = new Set<object>()): value is ReactJsonValue {',
      "  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;",
      "  if (typeof value === 'number') return Number.isFinite(value);",
      "  if (typeof value !== 'object' || value === null || active.has(value)) return false;",
      '  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;',
      '  active.add(value);',
      '  try { return Object.values(value).every((item: unknown) => isReactJsonValue(item, active)); } finally { active.delete(value); }',
      '}',
    );
  }
  lines.push('export interface ReactPagePropsByModule {',
    ...modules.map(([module, shape]) => `  readonly ${JSON.stringify(module)}: ${renderReactJsonType(shape)};`), '}',
    "declare module '@fluojs/react' { interface ReactPagePropsRegistry extends ReactPagePropsByModule {} }",
    'export const reactPageModules = {');
  for (const [module, shape] of modules) {
    lines.push(`  ${JSON.stringify(module)}: { decodeProps(value: unknown): ReactPagePropsByModule[${JSON.stringify(module)}] {`,
      `    if (!${call(shape, 'value')}) throw new TypeError('Invalid generated page props.');`,
      '    return value;', '  } },');
  }
  lines.push('} as const;');
  contracts.forms.forEach((form, index) => {
    const input = renderReactJsonType({
      kind: 'object', fields: Object.fromEntries(form.input.map((field) => [field.property, field])),
    });
    const data = form.data === undefined ? 'undefined'
      : `${renderReactJsonType(form.data)}${form.dataOptional === true ? ' | undefined' : ''}`;
    lines.push(`const formContract${index}: ReactFormContract<${input}, ${data}> = {`,
      `  fields: ${JSON.stringify(Object.fromEntries(form.input.map((field) => [field.property, field.wire])))},`,
      `  decodeSaved(value: unknown): ${data} {`,
      ...(form.dataOptional === true ? ['    if (value === undefined) return undefined;'] : []),
      `    if (${form.data === undefined ? 'value !== undefined' : `!${call(form.data, 'value')}`}) throw new TypeError('Invalid generated saved data.');`,
      '    return value;', '  },', '};');
  });
  lines.push('export const reactFormRoutes = {');
  contracts.forms.forEach((form, index) => {
    const paramsType = `{ ${form.params.map((param) => `readonly ${JSON.stringify(param)}: string;`).join(' ')} }`;
    const params = form.params.length === 0 ? '' : `<Actual extends ${paramsType}>(params: Actual & Record<Actual extends ${paramsType} ? Exclude<keyof Actual, keyof ${paramsType}> : never, never>)`;
    const href = form.params.length === 0 ? JSON.stringify(form.path)
      : `[${form.path.split('/').slice(1).map((segment) => segment.startsWith(':')
        ? `'/' + encodeURIComponent(params[${JSON.stringify(segment.slice(1))}])` : JSON.stringify(`/${segment}`)).join(', ')}].join('')`;
    lines.push(`  ${JSON.stringify(form.id)}: {`,
      `    href: ${params === '' ? '()' : params}: string => ${href},`,
      `    contract: formContract${index},`, '  },');
  });
  lines.push('} as const;');
  return lines;
}
