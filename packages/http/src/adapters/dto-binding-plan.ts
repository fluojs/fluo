import { type Constructor, type MetadataPropertyKey, type MetadataSource } from '@fluojs/core';
import {
  getClassValidationRules,
  getDtoBindingSchema,
  getDtoValidationSchema,
  type DtoBindingSchemaEntry,
  type DtoFieldBindingMetadata,
  type DtoFieldValidationRule,
} from '@fluojs/core/internal';

import type { FrameworkRequest } from '../types.js';

function toFieldName(propertyKey: MetadataPropertyKey): string {
  return typeof propertyKey === 'string' ? propertyKey : String(propertyKey);
}

function resolveSourceKey(propertyKey: MetadataPropertyKey, key?: string): string {
  return key ?? toFieldName(propertyKey);
}

function readHeader(request: FrameworkRequest, key: string): string | string[] | undefined {
  return request.headers[key.toLowerCase()] ?? request.headers[key];
}

export interface CompiledDtoBindingPlanEntry {
  readonly converter?: DtoFieldBindingMetadata['converter'];
  readonly fieldName: string;
  readonly optional: boolean;
  readonly propertyKey: MetadataPropertyKey;
  readonly read: (request: FrameworkRequest) => unknown;
  readonly source: MetadataSource;
  readonly sourceKey: string;
}

export interface CompiledDtoBindingPlan {
  readonly bodyKeys: ReadonlySet<string>;
  readonly entries: readonly CompiledDtoBindingPlanEntry[];
  readonly hasFieldConverters: boolean;
  readonly needsValidation: boolean;
  readonly propertyKeys: readonly MetadataPropertyKey[];
  readonly toValidationValue: (value: unknown) => unknown;
}

const dtoBindingPlanCache = new WeakMap<Constructor, CompiledDtoBindingPlan>();

function createSourceReader(source: MetadataSource, sourceKey: string): (request: FrameworkRequest) => unknown {
  switch (source) {
    case 'path':
      return (request) => request.params[sourceKey];
    case 'query':
      return (request) => request.query[sourceKey];
    case 'header':
      return (request) => readHeader(request, sourceKey);
    case 'cookie':
      return (request) => request.cookies[sourceKey];
    case 'body':
      return (request) => (request.body as Record<string, unknown> | undefined)?.[sourceKey];
    default:
      return () => undefined;
  }
}

function identityValidationValue(value: unknown): unknown {
  return value;
}

function createValidationValueFilter(
  propertyKeys: readonly MetadataPropertyKey[],
): (value: unknown) => unknown {
  return (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const source = value as Record<PropertyKey, unknown>;
    const filtered: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(value));

    for (const propertyKey of propertyKeys) {
      if (Object.hasOwn(source, propertyKey)) {
        filtered[propertyKey] = source[propertyKey];
      }
    }

    return filtered;
  };
}

function isDtoAwareValidationRule(rule: DtoFieldValidationRule): boolean {
  return rule.kind === 'custom' || rule.kind === 'validateIf';
}

export function getCompiledDtoBindingPlan(dto: Constructor): CompiledDtoBindingPlan {
  const cached = dtoBindingPlanCache.get(dto);

  if (cached) {
    return cached;
  }

  const entries = getDtoBindingSchema(dto).map((entry: DtoBindingSchemaEntry) => {
    const sourceKey = resolveSourceKey(entry.propertyKey, entry.metadata.key);

    return {
      ...(entry.metadata.converter === undefined ? {} : { converter: entry.metadata.converter }),
      fieldName: toFieldName(entry.propertyKey),
      optional: entry.metadata.optional === true,
      propertyKey: entry.propertyKey,
      read: createSourceReader(entry.metadata.source, sourceKey),
      source: entry.metadata.source,
      sourceKey,
    } satisfies CompiledDtoBindingPlanEntry;
  });
  const propertyKeys = entries.map((entry: CompiledDtoBindingPlanEntry) => entry.propertyKey);
  const boundPropertyKeys = new Set(propertyKeys);
  const validationSchema = getDtoValidationSchema(dto);
  const validationPropertyKeys = validationSchema.map((entry: { propertyKey: MetadataPropertyKey }) => entry.propertyKey);
  const hasClassValidationRules = getClassValidationRules(dto).length > 0;
  const hasDtoAwareValidationRules = validationSchema.some((entry: { rules: readonly DtoFieldValidationRule[] }) =>
    entry.rules.some((rule: DtoFieldValidationRule) => isDtoAwareValidationRule(rule))
  );
  const needsValidation = hasClassValidationRules || validationPropertyKeys.length > 0;
  const requiresValidationFilter = hasClassValidationRules
    || hasDtoAwareValidationRules
    || validationPropertyKeys.some((propertyKey: MetadataPropertyKey) => !boundPropertyKeys.has(propertyKey));

  const next: CompiledDtoBindingPlan = {
    bodyKeys: new Set(entries.filter((entry: CompiledDtoBindingPlanEntry) => entry.source === 'body').map((entry: CompiledDtoBindingPlanEntry) => entry.sourceKey)),
    entries,
    hasFieldConverters: entries.some((entry: CompiledDtoBindingPlanEntry) => entry.converter !== undefined),
    needsValidation,
    propertyKeys,
    toValidationValue: requiresValidationFilter ? createValidationValueFilter(propertyKeys) : identityValidationValue,
  };

  dtoBindingPlanCache.set(dto, next);
  return next;
}
