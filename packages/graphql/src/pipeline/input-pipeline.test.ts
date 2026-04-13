import { describe, expect, it } from 'vitest';

import { IsBoolean, IsInt, MinLength } from '@fluojs/validation';

import { Arg } from '../decorators.js';
import { createGraphqlInput, resolveArgScalarType, resolveArgType } from './input-pipeline.js';
import { listOf } from '../types.js';
import type { ResolverHandlerDescriptor } from '../types.js';

class ScalarInput {
  @Arg('count')
  @IsInt()
  count = 0;

  @Arg('enabled')
  @IsBoolean()
  enabled = false;
}

class TextInput {
  @Arg('value')
  @MinLength(3)
  value = '';
}

function createHandlerDescriptor(inputClass: Function): ResolverHandlerDescriptor {
  return {
    argFields: [
      { argName: 'count', fieldName: 'count' },
      { argName: 'enabled', fieldName: 'enabled' },
      { argName: 'value', fieldName: 'value' },
    ],
    fieldName: 'noop',
    inputClass,
    methodKey: 'noop',
    methodName: 'noop',
    type: 'query',
  };
}

describe('graphql input pipeline helpers', () => {
it('infers scalar types from dto metadata', () => {
    const scalarHandler = createHandlerDescriptor(ScalarInput);

    expect(resolveArgScalarType(scalarHandler, 'count')).toBe('int');
    expect(resolveArgScalarType(scalarHandler, 'enabled')).toBe('boolean');
  });

  it('validates dto input before resolver invocation', async () => {
    await expect(
      createGraphqlInput(TextInput, { value: 'ab' }, [{ argName: 'value', fieldName: 'value' }]),
    ).rejects.toThrow('Validation failed.');
  });

  it('resolves explicit list arg types from decorator metadata', () => {
    const handler = createHandlerDescriptor(ScalarInput);
    handler.argTypes = {
      value: listOf('string'),
    };

    expect(resolveArgType(handler, 'value')).toEqual(listOf('string'));
  });

  it('skips unsafe keys when materializing DTO input without explicit arg descriptors', async () => {
    class UnsafeInput {
      value = 'safe';
    }

    const maliciousArgs = Object.create(null) as Record<string, unknown>;
    maliciousArgs.__proto__ = {
      polluted: true,
    };
    maliciousArgs.value = 'updated';

    const input = (await createGraphqlInput(UnsafeInput, maliciousArgs, [])) as UnsafeInput & { polluted?: boolean };

    expect(input.value).toBe('updated');
    expect(Object.getPrototypeOf(input)).toBe(UnsafeInput.prototype);
    expect(input.polluted).toBeUndefined();
  });
});
