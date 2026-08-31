import { describe, expect, it } from 'vitest';

import { IsEnum } from './decorators.js';
import { DefaultValidator } from './validation.js';

const NumericRole = {
  0: 'Admin',
  1: 'User',
  Admin: 0,
  User: 1,
} as const;

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
});
