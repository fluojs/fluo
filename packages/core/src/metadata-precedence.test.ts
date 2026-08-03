import { describe, expect, it } from 'vitest';

import {
  getOwnStandardConstructorMetadataBag,
  getStandardMetadataBag,
  type StandardMetadataBag,
  standardMetadataKeys,
} from './metadata/shared.js';
import {
  appendDtoFieldValidationRule,
  ensureMetadataSymbol,
  getDtoFieldValidationRules,
  getDtoValidationSchema,
} from './metadata.js';

describe('metadata precedence', () => {
  it('places standard DTO validation rules before stored rules in field reader output', () => {
    // Given
    class ExampleDto {
      declare readonly name: string;
    }

    Object.defineProperty(ExampleDto, ensureMetadataSymbol(), {
      configurable: true,
      value: {
        [standardMetadataKeys.dtoFieldValidation]: new Map([
          ['name', [{ kind: 'minLength', value: 3 }]],
        ]),
      },
    });
    appendDtoFieldValidationRule(ExampleDto.prototype, 'name', {
      kind: 'minLength',
      value: 11,
    });

    // When
    const rules = getDtoFieldValidationRules(ExampleDto.prototype, 'name');

    // Then
    expect(rules).toEqual([
      { kind: 'minLength', value: 3 },
      { kind: 'minLength', value: 11 },
    ]);
  });

  it('places standard DTO validation rules before stored rules in schema reader output', () => {
    // Given
    class ExampleDto {
      declare readonly name: string;
    }

    Object.defineProperty(ExampleDto, ensureMetadataSymbol(), {
      configurable: true,
      value: {
        [standardMetadataKeys.dtoFieldValidation]: new Map([
          ['name', [{ kind: 'maxLength', value: 17 }]],
        ]),
      },
    });
    appendDtoFieldValidationRule(ExampleDto.prototype, 'name', {
      kind: 'maxLength',
      value: 5,
    });

    // When
    const schema = getDtoValidationSchema(ExampleDto);

    // Then
    expect(schema).toEqual([
      {
        propertyKey: 'name',
        rules: [
          { kind: 'maxLength', value: 17 },
          { kind: 'maxLength', value: 5 },
        ],
      },
    ]);
  });

  it('prefers native metadata over same-constructor fallback metadata while supplementing inherited keys', () => {
    // Given
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const fallbackSymbol = ensureMetadataSymbol();
    const nativeSymbol = Symbol('native.metadata');
    const inheritedFallbackInjectionMetadata = new Map([['service', { optional: true, token: 'INHERITED_FALLBACK_LOGGER' }]]);
    const ownFallbackBag: StandardMetadataBag = {
      [standardMetadataKeys.controller]: { basePath: '/child-fallback' },
    };
    const ownNativeBag: StandardMetadataBag = {
      [standardMetadataKeys.controller]: { basePath: '/child-native' },
    };

    class BaseController {}
    class ChildController extends BaseController {}

    Object.defineProperty(BaseController, fallbackSymbol, {
      configurable: true,
      value: {
        [standardMetadataKeys.injection]: inheritedFallbackInjectionMetadata,
      },
    });
    Object.defineProperty(ChildController, fallbackSymbol, {
      configurable: true,
      value: ownFallbackBag,
    });
    Object.defineProperty(Symbol, 'metadata', {
      configurable: true,
      value: nativeSymbol,
    });
    Object.defineProperty(ChildController, nativeSymbol, {
      configurable: true,
      value: ownNativeBag,
    });

    try {
      // When
      const metadataBag = getStandardMetadataBag(ChildController);

      // Then
      expect(metadataBag?.[standardMetadataKeys.controller]).toEqual({ basePath: '/child-native' });
      expect(metadataBag?.[standardMetadataKeys.injection]).toBe(inheritedFallbackInjectionMetadata);
      expect(getOwnStandardConstructorMetadataBag(ChildController)).toBe(ownNativeBag);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        Reflect.deleteProperty(Symbol, 'metadata');
      }
      ensureMetadataSymbol();
    }
  });
});
