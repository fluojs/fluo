import { describe, expect, it } from 'vitest';

import * as coreRequestPipelineApi from './request-pipeline.js';

type SymbolConstructorWithMetadata = typeof Symbol & { metadata?: symbol };

describe('@fluojs/core/request-pipeline public API behavior', () => {
  it('keeps metadata bag helpers executable for first-party integrations', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const metadataSymbol = coreRequestPipelineApi.ensureRequestPipelineMetadataSymbol();
    const inheritedKey = Symbol('request-pipeline.inherited');
    const ownKey = Symbol('request-pipeline.own');

    class BaseDto {}
    class RequestDto extends BaseDto {}

    const baseMetadata = {
      [inheritedKey]: 'base-metadata',
      [ownKey]: 'base-overridden',
    };

    Object.defineProperty(BaseDto, metadataSymbol, {
      configurable: true,
      value: baseMetadata,
    });
    Object.defineProperty(RequestDto, metadataSymbol, {
      configurable: true,
      value: {
        [ownKey]: 'request-metadata',
      },
    });

    try {
      const effectiveBag = coreRequestPipelineApi.getRequestPipelineMetadataBag(RequestDto);
      const ownBag = coreRequestPipelineApi.getOwnConstructorRequestPipelineMetadataBag(RequestDto);

      expect(effectiveBag?.[ownKey]).toBe('request-metadata');
      expect(effectiveBag?.[inheritedKey]).toBe('base-metadata');
      expect(ownBag?.[ownKey]).toBe('request-metadata');
      expect(ownBag?.[inheritedKey]).toBeUndefined();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        delete (Symbol as SymbolConstructorWithMetadata).metadata;
      }
    }
  });

  it('keeps DTO binding and validation helpers executable', () => {
    const propertyKey = 'accountId';

    class RequestDto {
      declare readonly accountId: string;
    }

    coreRequestPipelineApi.defineDtoFieldBindingMetadata(RequestDto.prototype, propertyKey, {
      key: 'accountId',
      optional: false,
      source: 'path',
    });
    coreRequestPipelineApi.appendDtoFieldValidationRule(RequestDto.prototype, propertyKey, {
      kind: 'string',
      message: 'accountId must be a string',
    });

    expect(coreRequestPipelineApi.getDtoFieldBindingMetadata(RequestDto.prototype, propertyKey)).toEqual({
      key: 'accountId',
      optional: false,
      source: 'path',
    });
    expect(coreRequestPipelineApi.getDtoBindingSchema(RequestDto)).toEqual([
      {
        metadata: {
          key: 'accountId',
          optional: false,
          source: 'path',
        },
        propertyKey,
      },
    ]);
    expect(coreRequestPipelineApi.getDtoValidationSchema(RequestDto)).toEqual([
      {
        propertyKey,
        rules: [
          {
            kind: 'string',
            message: 'accountId must be a string',
          },
        ],
      },
    ]);
  });
});
