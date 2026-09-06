import { Controller, createHandlerMapping, FromBody, Get, Post, RequestDto } from '@fluojs/http';
import { ApiBody, ApiOperation, buildOpenApiDocument, getMethodApiMetadata } from '@fluojs/openapi';
import { IsString } from '@fluojs/validation';
import { describe, expect, it } from 'vitest';

describe('OpenAPI empty option defaults', () => {
  it.each([
    { name: 'ApiOperation', factory: ApiOperation, key: 'operation' },
    { name: 'ApiBody', factory: ApiBody, key: 'requestBody' },
  ] as const)('$name keeps omitted and undefined metadata equal to an explicit empty object', ({ factory, key }) => {
    // Given / When
    class Routes {
      @factory()
      omitted() {}
      @factory(undefined)
      undefinedOptions() {}
      @factory({})
      empty() {}
    }

    // Then
    const expected = getMethodApiMetadata(Routes, 'empty');
    expect(expected?.[key]).toBeDefined();
    expect(getMethodApiMetadata(Routes, 'omitted')).toEqual(expected);
    expect(getMethodApiMetadata(Routes, 'undefinedOptions')).toEqual(expected);
  });

  it.each([ApiOperation, ApiBody])('preserves null failure when the decorator is applied', (factory) => {
    // Given: null is outside the type contract; the existing failure is deferred until application.
    const decorator = Reflect.apply(factory, undefined, [null]);

    // When / Then
    expect(() => {
      class Invalid {
        @decorator
        index() {}
      }
      return Invalid;
    }).toThrow(TypeError);
  });

  it('keeps empty writes observable in stacking and preserves read snapshots', () => {
    // Given / When: TC39 applies the decorator nearest the method first.
    class Routes {
      @ApiOperation()
      @ApiOperation({ summary: 'Earlier', deprecated: true })
      @ApiBody()
      @ApiBody({ required: true, schema: { type: 'string' } })
      cleared() {}

      @ApiOperation({ summary: 'Later', deprecated: true })
      @ApiOperation(undefined)
      @ApiBody({ required: true, schema: { type: 'string' } })
      @ApiBody(undefined)
      populated() {}

      undecorated() {}
    }
    const snapshot = getMethodApiMetadata(Routes, 'cleared');

    // Then
    expect(snapshot?.operation).toEqual({ summary: undefined, description: undefined, deprecated: undefined });
    expect(snapshot?.requestBody).toEqual({});
    expect(getMethodApiMetadata(Routes, 'undecorated')).toBeUndefined();
    expect(getMethodApiMetadata(Routes, 'populated')).toMatchObject({
      operation: { summary: 'Later', deprecated: true },
      requestBody: { required: true, schema: { type: 'string' } },
    });
    if (!snapshot?.operation || !snapshot.requestBody) {
      throw new TypeError('Expected stored empty OpenAPI metadata.');
    }
    snapshot.operation.summary = 'mutated';
    snapshot.requestBody.required = true;
    expect(getMethodApiMetadata(Routes, 'cleared')?.operation?.summary).toBeUndefined();
    expect(getMethodApiMetadata(Routes, 'cleared')?.requestBody).toEqual({});
  });

  it.each([
    { name: 'omitted', operation: () => ApiOperation(), body: () => ApiBody() },
    { name: 'undefined', operation: () => ApiOperation(undefined), body: () => ApiBody(undefined) },
    { name: 'empty object', operation: () => ApiOperation({}), body: () => ApiBody({}) },
  ])('generates only defined document fields and preserves inferred DTO bodies for $name', ({ operation, body }) => {
    // Given
    class Input {
      @FromBody()
      @IsString()
      name = '';
    }
    @Controller('/cats')
    class Routes {
      @operation()
      @body()
      @Get()
      list() {}

      @operation()
      @body()
      @RequestDto(Input)
      @Post()
      create() {}
    }

    // When
    const document = buildOpenApiDocument({
      descriptors: createHandlerMapping([{ controllerToken: Routes }]).descriptors,
      defaultErrorResponsesPolicy: 'omit',
      title: 'Defaults',
      version: '1',
    });
    const list = document.paths['/cats']?.get;
    const create = document.paths['/cats']?.post;

    // Then: absence means no own serialized property, not merely undefined values.
    expect(list).toBeDefined();
    expect(create).toBeDefined();
    for (const result of [list, create]) {
      for (const field of ['summary', 'description', 'deprecated']) {
        expect(Object.hasOwn(result ?? {}, field)).toBe(false);
      }
    }
    expect(Object.hasOwn(list ?? {}, 'requestBody')).toBe(false);
    expect(create?.requestBody).toEqual({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } },
      required: true,
    });
    expect(document.components?.schemas?.Input).toEqual({
      additionalProperties: false,
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
  });
});
