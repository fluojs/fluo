export const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const valueTypeMatches = (type, value) => {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isSafeInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
};

const resolveReference = (reference, rootSchema) => {
  if (!reference.startsWith('#/')) {
    throw new TypeError(`unsupported schema reference ${reference}`);
  }
  return reference
    .slice(2)
    .split('/')
    .reduce((schema, segment) => schema?.[segment], rootSchema);
};

const isLeapYear = (year) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

export const isStrictRfc3339DateTime = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    Number(hourText) <= 23 &&
    Number(minuteText) <= 59 &&
    Number(secondText) <= 59 &&
    (offsetSign === undefined ||
      (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59))
  );
};

export const schemaFailure = (schema, value, path, rootSchema = schema) => {
  if (schema.$ref !== undefined) {
    const target = resolveReference(schema.$ref, rootSchema);
    if (target === undefined) {
      return `${path} references an unknown schema`;
    }
    return schemaFailure(target, value, path, rootSchema);
  }
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter(
      (candidate) => schemaFailure(candidate, value, path, rootSchema) === null,
    );
    return matches.length === 1
      ? null
      : `${path} must match exactly one variant`;
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    return `${path} must equal ${JSON.stringify(schema.const)}`;
  }
  if (
    schema.enum !== undefined &&
    !schema.enum.some((item) => Object.is(item, value))
  ) {
    return `${path} must be one of ${schema.enum.join(', ')}`;
  }
  if (schema.type !== undefined && !valueTypeMatches(schema.type, value)) {
    return `${path} must be ${schema.type}`;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path} must not be empty`;
    }
    if (schema.format === 'date-time' && !isStrictRfc3339DateTime(value)) {
      return `${path} must be an RFC 3339 date-time`;
    }
    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern, 'u').test(value)
    ) {
      return `${path} does not match its canonical pattern`;
    }
  }
  if (Number.isSafeInteger(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${path} is below its minimum`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${path} is above its maximum`;
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path} must contain at least ${String(schema.minItems)} item(s)`;
    }
    if (schema.uniqueItems === true) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) {
        return `${path} must contain unique items`;
      }
    }
    if (schema.items !== undefined) {
      for (const [index, item] of value.entries()) {
        const failure = schemaFailure(
          schema.items,
          item,
          `${path}[${String(index)}]`,
          rootSchema,
        );
        if (failure !== null) {
          return failure;
        }
      }
    }
  }
  if (isRecord(value)) {
    if (
      schema.minProperties !== undefined &&
      Object.keys(value).length < schema.minProperties
    ) {
      return `${path} must contain at least ${String(schema.minProperties)} property(ies)`;
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        return `${path}.${key} is required`;
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        const failure = schemaFailure(
          properties[key],
          item,
          `${path}.${key}`,
          rootSchema,
        );
        if (failure !== null) {
          return failure;
        }
      } else if (schema.additionalProperties === false) {
        return `${path} has unknown key ${key}`;
      } else if (isRecord(schema.additionalProperties)) {
        const failure = schemaFailure(
          schema.additionalProperties,
          item,
          `${path}.${key}`,
          rootSchema,
        );
        if (failure !== null) {
          return failure;
        }
      }
    }
  }
  return null;
};
