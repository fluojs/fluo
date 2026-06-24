import type { DtoFieldValidationRule } from '@fluojs/core/request-pipeline';

import { isPlainObject } from './object-utils.js';
import { runValidatorJs } from './validator-js-adapter.js';

type RuleKind = DtoFieldValidationRule['kind'];

export type NonCustomRule = Exclude<DtoFieldValidationRule, { kind: 'custom' | 'nested' }>;

type RuleHandler<K extends RuleKind> = {
  defaultCode: string;
  describe: (field: string, rule: Extract<DtoFieldValidationRule, { kind: K }>) => string;
  validate: (rule: Extract<DtoFieldValidationRule, { kind: K }>, value: unknown) => boolean;
};

function isEmptyValue(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

const ruleHandlers: { [K in RuleKind]: RuleHandler<K> } = {
  validateIf: {
    defaultCode: 'VALIDATE_IF',
    describe: (field) => `${field} is conditionally invalid.`,
    validate: () => true,
  },
  defined: {
    defaultCode: 'REQUIRED',
    describe: (field) => `${field} is required.`,
    validate: (_rule, value) => value !== undefined && value !== null,
  },
  optional: {
    defaultCode: 'OPTIONAL',
    describe: (field) => `${field} is optional.`,
    validate: () => true,
  },
  equals: {
    defaultCode: 'EQUALS',
    describe: (field, rule) => `${field} must equal ${String(rule.value)}.`,
    validate: (rule, value) => value === rule.value,
  },
  notEquals: {
    defaultCode: 'NOT_EQUALS',
    describe: (field, rule) => `${field} must not equal ${String(rule.value)}.`,
    validate: (rule, value) => value !== rule.value,
  },
  empty: {
    defaultCode: 'EMPTY',
    describe: (field) => `${field} must be empty.`,
    validate: (_rule, value) => isEmptyValue(value),
  },
  notEmpty: {
    defaultCode: 'NOT_EMPTY',
    describe: (field) => `${field} should not be empty.`,
    validate: (_rule, value) => !isEmptyValue(value),
  },
  in: {
    defaultCode: 'IN',
    describe: (field) => `${field} must be one of the allowed values.`,
    validate: (rule, value) => rule.values.includes(value),
  },
  notIn: {
    defaultCode: 'NOT_IN',
    describe: (field) => `${field} contains a forbidden value.`,
    validate: (rule, value) => !rule.values.includes(value),
  },
  string: {
    defaultCode: 'INVALID_STRING',
    describe: (field) => `${field} must be a string.`,
    validate: (_rule, value) => typeof value === 'string',
  },
  number: {
    defaultCode: 'INVALID_NUMBER',
    describe: (field) => `${field} must be a number.`,
    validate: (rule, value) => typeof value === 'number' && (rule.allowNaN || !Number.isNaN(value)),
  },
  boolean: {
    defaultCode: 'INVALID_BOOLEAN',
    describe: (field) => `${field} must be a boolean.`,
    validate: (_rule, value) => typeof value === 'boolean',
  },
  date: {
    defaultCode: 'INVALID_DATE',
    describe: (field) => `${field} must be a Date instance.`,
    validate: (_rule, value) => value instanceof Date && !Number.isNaN(value.getTime()),
  },
  array: {
    defaultCode: 'INVALID_ARRAY',
    describe: (field) => `${field} must be an array.`,
    validate: (_rule, value) => Array.isArray(value),
  },
  object: {
    defaultCode: 'INVALID_OBJECT',
    describe: (field) => `${field} must be an object.`,
    validate: (_rule, value) => isPlainObject(value),
  },
  enum: {
    defaultCode: 'INVALID_ENUM',
    describe: (field) => `${field} must be a supported enum value.`,
    validate: (rule, value) => rule.values.includes(value),
  },
  int: {
    defaultCode: 'INVALID_INT',
    describe: (field) => `${field} must be an integer.`,
    validate: (_rule, value) => typeof value === 'number' && Number.isInteger(value),
  },
  divisibleBy: {
    defaultCode: 'DIVISIBLE_BY',
    describe: (field, rule) => `${field} must be divisible by ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'number' && !Number.isNaN(value) && value % rule.value === 0,
  },
  positive: {
    defaultCode: 'POSITIVE',
    describe: (field) => `${field} must be positive.`,
    validate: (_rule, value) => typeof value === 'number' && value > 0,
  },
  negative: {
    defaultCode: 'NEGATIVE',
    describe: (field) => `${field} must be negative.`,
    validate: (_rule, value) => typeof value === 'number' && value < 0,
  },
  min: {
    defaultCode: 'MIN',
    describe: (field, rule) => `${field} must be greater than or equal to ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'number' && !Number.isNaN(value) && value >= rule.value,
  },
  max: {
    defaultCode: 'MAX',
    describe: (field, rule) => `${field} must be less than or equal to ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'number' && !Number.isNaN(value) && value <= rule.value,
  },
  minDate: {
    defaultCode: 'MIN_DATE',
    describe: (field, rule) => `${field} must be on or after ${rule.value.toISOString()}.`,
    validate: (rule, value) => value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() >= rule.value.getTime(),
  },
  maxDate: {
    defaultCode: 'MAX_DATE',
    describe: (field, rule) => `${field} must be on or before ${rule.value.toISOString()}.`,
    validate: (rule, value) => value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() <= rule.value.getTime(),
  },
  contains: {
    defaultCode: 'CONTAINS',
    describe: (field, rule) => `${field} must contain ${rule.value}.`,
    validate: (rule, value) => typeof value === 'string' && value.includes(rule.value),
  },
  notContains: {
    defaultCode: 'NOT_CONTAINS',
    describe: (field, rule) => `${field} must not contain ${rule.value}.`,
    validate: (rule, value) => typeof value === 'string' && !value.includes(rule.value),
  },
  length: {
    defaultCode: 'LENGTH',
    describe: (field) => `${field} must have a valid length.`,
    validate: (rule, value) => typeof value === 'string' && value.length >= rule.min && (rule.max === undefined || value.length <= rule.max),
  },
  minLength: {
    defaultCode: 'MIN_LENGTH',
    describe: (field, rule) => `${field} must have length at least ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'string' && value.length >= rule.value,
  },
  maxLength: {
    defaultCode: 'MAX_LENGTH',
    describe: (field, rule) => `${field} must have length at most ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'string' && value.length <= rule.value,
  },
  nested: {
    defaultCode: 'INVALID_NESTED',
    describe: (field) => `${field} contains invalid nested data.`,
    validate: () => true,
  },
  validatorjs: {
    defaultCode: 'INVALID_FIELD',
    describe: (field) => `${field} is invalid.`,
    validate: (rule, value) => runValidatorJs(rule, value),
  },
  arrayContains: {
    defaultCode: 'ARRAY_CONTAINS',
    describe: (field) => `${field} must contain the required values.`,
    validate: (rule, value) => Array.isArray(value) && rule.values.every((expected: unknown) => value.includes(expected)),
  },
  arrayNotContains: {
    defaultCode: 'ARRAY_NOT_CONTAINS',
    describe: (field) => `${field} contains forbidden values.`,
    validate: (rule, value) => Array.isArray(value) && rule.values.every((expected: unknown) => !value.includes(expected)),
  },
  arrayNotEmpty: {
    defaultCode: 'ARRAY_NOT_EMPTY',
    describe: (field) => `${field} must not be an empty array.`,
    validate: (_rule, value) => Array.isArray(value) && value.length > 0,
  },
  arrayMinSize: {
    defaultCode: 'ARRAY_MIN_SIZE',
    describe: (field, rule) => `${field} must contain at least ${String(rule.value)} items.`,
    validate: (rule, value) => Array.isArray(value) && value.length >= rule.value,
  },
  arrayMaxSize: {
    defaultCode: 'ARRAY_MAX_SIZE',
    describe: (field, rule) => `${field} must contain at most ${String(rule.value)} items.`,
    validate: (rule, value) => Array.isArray(value) && value.length <= rule.value,
  },
  arrayUnique: {
    defaultCode: 'ARRAY_UNIQUE',
    describe: (field) => `${field} must contain unique values.`,
    validate: (rule, value) => {
      if (!Array.isArray(value)) return false;
      const seen = new Set<unknown>();
      for (const entry of value) {
        const key = rule.selector ? rule.selector(entry) : entry;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
  },
  custom: {
    defaultCode: 'INVALID_FIELD',
    describe: (field) => `${field} is invalid.`,
    validate: () => true,
  },
};

export function getRuleHandler<K extends RuleKind>(rule: Extract<DtoFieldValidationRule, { kind: K }>): RuleHandler<K> {
  return ruleHandlers[rule.kind] as RuleHandler<K>;
}
