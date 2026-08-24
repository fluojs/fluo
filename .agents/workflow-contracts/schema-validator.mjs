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

export const schemaFailure = (schema, value, path) => {
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter(
      (candidate) => schemaFailure(candidate, value, path) === null,
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
        );
        if (failure !== null) {
          return failure;
        }
      }
    }
  }
  if (isRecord(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        return `${path}.${key} is required`;
      }
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      const unknownKey = Object.keys(value).find(
        (key) => !Object.hasOwn(properties, key),
      );
      if (unknownKey !== undefined) {
        return `${path} has unknown key ${unknownKey}`;
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        const failure = schemaFailure(
          propertySchema,
          value[key],
          `${path}.${key}`,
        );
        if (failure !== null) {
          return failure;
        }
      }
    }
  }
  return null;
};
