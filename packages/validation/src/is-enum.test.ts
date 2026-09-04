import { describe, expect, it } from 'vitest';

import { IsEnum } from './decorators.js';
import { DefaultValidator } from './validation.js';

const NumericRole = {
  0: 'Admin',
  1: 'User',
  Admin: 0,
  User: 1,
} as const;

const StringRole = {
  Admin: 'admin',
  User: 'user',
} as const;

enum MixedValue {
  StringValue = 'NumericValue',
  NumericValue = NaN,
}

enum NumericEdge {
  NotANumber = NaN,
  PositiveInfinity = Infinity,
  NegativeInfinity = -Infinity,
  NegativeFraction = -1.5,
  Zero = -0,
}

enum PrototypeCollision {
  __proto__ = 0,
}

enum CanonicalStringMember {
  NaN = '__proto__',
  Infinity = 'infinity',
}

describe('IsEnum', () => {
  it('rejects a numeric enum reverse-map name', async () => {
    // Given
    class RoleDto {
      @IsEnum(NumericRole)
      role: unknown = NumericRole.User;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(Object.assign(new RoleDto(), { role: 'Admin' }), RoleDto);

    // Then
    await expect(validation).rejects.toMatchObject({
      issues: [{ code: 'INVALID_ENUM', field: 'role' }],
    });
  });

  it('accepts a numeric enum value', async () => {
    // Given
    class RoleDto {
      @IsEnum(NumericRole)
      role: unknown = NumericRole.User;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new RoleDto(), RoleDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });

  it('accepts an ordinary string enum-like value', async () => {
    // Given
    class RoleDto {
      @IsEnum(StringRole)
      role: unknown = StringRole.User;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new RoleDto(), RoleDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });

  it('accepts a declared string value that matches a numeric member name', async () => {
    // Given
    class MixedValueDto {
      @IsEnum(MixedValue)
      value: unknown = MixedValue.StringValue;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new MixedValueDto(), MixedValueDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });

  it('accepts the declared numeric value from a mixed enum', async () => {
    // Given
    class MixedValueDto {
      @IsEnum(MixedValue)
      value: unknown = MixedValue.NumericValue;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new MixedValueDto(), MixedValueDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });

  it.each([
    ['NaN', NumericEdge.NotANumber],
    ['positive infinity', NumericEdge.PositiveInfinity],
    ['negative infinity', NumericEdge.NegativeInfinity],
    ['a negative fraction', NumericEdge.NegativeFraction],
    ['negative zero', NumericEdge.Zero],
  ])('accepts the declared numeric enum value %s', async (_label, value) => {
    // Given
    class NumericEdgeDto {
      @IsEnum(NumericEdge)
      edge: unknown = value;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new NumericEdgeDto(), NumericEdgeDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });

  it.each([
    ['NaN', CanonicalStringMember.NaN],
    ['Infinity', CanonicalStringMember.Infinity],
  ])('accepts the declared string enum value with canonical numeric member name %s', async (_label, value) => {
    // Given
    class CanonicalStringMemberDto {
      @IsEnum(CanonicalStringMember)
      member: unknown = value;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new CanonicalStringMemberDto(), CanonicalStringMemberDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });

  it('rejects a generated prototype-colliding numeric enum reverse-map name', async () => {
    // Given
    class PrototypeCollisionDto {
      @IsEnum(PrototypeCollision)
      value: unknown = PrototypeCollision.__proto__;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(Object.assign(new PrototypeCollisionDto(), { value: '__proto__' }), PrototypeCollisionDto);

    // Then
    await expect(validation).rejects.toMatchObject({
      issues: [{ code: 'INVALID_ENUM', field: 'value' }],
    });
  });

  it('accepts a prototype-colliding numeric enum value', async () => {
    // Given
    class PrototypeCollisionDto {
      @IsEnum(PrototypeCollision)
      value: unknown = 0;
    }

    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new PrototypeCollisionDto(), PrototypeCollisionDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });
});
