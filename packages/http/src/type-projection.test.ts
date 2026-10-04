import { describe, expect, it } from 'vitest';

import { Controller, Convert, FromBody, FromPath, FromQuery, Get, Optional, RequestDto } from './decorators.js';
import { createHttpTypeProjection } from './internal.js';
import { createHandlerMapping } from './mapping.js';

describe('HTTP tooling type projection', () => {
  it('retains actual object identity and compiled wire aliases without constructing a DTO', () => {
    // Given: bindings distinguish property names, source aliases and optional materialization.
    class Input {
      constructor() {
        throw new Error('Projection must not instantiate application input.');
      }

      @FromPath('sku')
      product = '';

      @Optional()
      @FromQuery('tag')
      tags: string[] = [];

      @Convert({ convert(value: unknown) { return Number(value); } })
      @FromQuery('page')
      page = 1;

      @FromBody('display_name')
      name = '';
    }
    @Controller('/items')
    class ItemsController {
      @Get('/:sku')
      @RequestDto(Input)
      show(_input: Input): void {}
    }
    const descriptor = createHandlerMapping([{ controllerToken: ItemsController }]).descriptors[0];
    if (descriptor === undefined) throw new TypeError('Expected compiled route.');

    // When: tooling projects the same metadata used by the binder.
    const projection = createHttpTypeProjection(descriptor);

    // Then: no constructor/name matching or converter execution is needed.
    expect(projection.controller).toBe(ItemsController);
    expect(projection.input).toBe(Input);
    expect(projection.fields).toEqual([
      { converted: false, optional: false, property: 'product', source: 'path', wire: 'sku' },
      { converted: false, optional: true, property: 'tags', source: 'query', wire: 'tag' },
      { converted: true, optional: false, property: 'page', source: 'query', wire: 'page' },
      { converted: false, optional: false, property: 'name', source: 'body', wire: 'display_name' },
    ]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.fields)).toBe(true);
    expect(projection.fields.every(Object.isFrozen)).toBe(true);
  });
});
