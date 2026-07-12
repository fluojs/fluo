import { describe, expect, it } from 'vitest';

import { IsEmail, IsString, ValidateClass } from './decorators.js';
import { DefaultValidator } from './validation.js';

describe('validation decorator metadata inheritance', () => {
  it('keeps subclass decorators from changing base DTO validation', async () => {
    // Given
    @ValidateClass(() => true)
    class BaseDto {
      @IsString()
      value = 'base-value';
    }

    @ValidateClass((dto: unknown) => (
      dto instanceof DerivedDto
        ? true
        : { code: 'DERIVED_CLASS', message: 'derived class rule must stay isolated' }
    ))
    class DerivedDto extends BaseDto {
      @IsEmail({ message: 'derived field rule must stay isolated' })
      override value = 'derived@example.com';
    }

    const validator = new DefaultValidator();

    // When / Then
    await expect(Promise.all([
      validator.validate(new BaseDto(), BaseDto),
      validator.validate(new DerivedDto(), DerivedDto),
    ])).resolves.toEqual([undefined, undefined]);
  });

  it('preserves inherited base rules when a subclass adds its own rules', async () => {
    // Given
    @ValidateClass(() => ({ code: 'BASE_CLASS', message: 'base class rule remains active' }))
    class BaseDto {
      @IsString({ message: 'base field rule remains active' })
      value: unknown = '';
    }

    @ValidateClass(() => ({ code: 'DERIVED_CLASS', message: 'derived class rule remains active' }))
    class DerivedDto extends BaseDto {
      @IsEmail({ message: 'derived field rule remains active' })
      override value: unknown = 42;
    }

    const validator = new DefaultValidator();

    // When / Then
    await expect(validator.validate(new DerivedDto(), DerivedDto)).rejects.toMatchObject({
      issues: [
        { code: 'INVALID_STRING', field: 'value', message: 'base field rule remains active' },
        { code: 'EMAIL', field: 'value', message: 'derived field rule remains active' },
        { code: 'BASE_CLASS', message: 'base class rule remains active' },
        { code: 'DERIVED_CLASS', message: 'derived class rule remains active' },
      ],
    });
  });
});
