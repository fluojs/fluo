import { describe, expect, it } from 'vitest';

import { IsDefined, IsNotEmpty, IsOptional, IsString, ValidateIf } from './decorators.js';
import { DefaultValidator } from './validation.js';

describe('validation migration contract', () => {
  it('skips ordinary validators for null and undefined field values', async () => {
    // Given
    class OptionalByAbsenceDto {
      @IsNotEmpty()
      nullableDescription: string | null = null;

      @IsString()
      nullableName: string | null = null;

      @IsNotEmpty()
      undefinedDescription: string | undefined = undefined;

      @IsString()
      undefinedName: string | undefined = undefined;
    }
    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new OptionalByAbsenceDto(), OptionalByAbsenceDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
  });

  it('skips synchronous ValidateIf predicates for optional missing values', async () => {
    // Given
    let predicateRuns = 0;
    class OptionalConditionalDto {
      @IsOptional()
      @ValidateIf(() => {
        predicateRuns += 1;
        return true;
      })
      @IsString()
      name: string | undefined = undefined;
    }
    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new OptionalConditionalDto(), OptionalConditionalDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
    expect(predicateRuns).toBe(0);
  });

  it('skips asynchronous ValidateIf predicates for optional missing values', async () => {
    // Given
    let predicateRuns = 0;
    class OptionalConditionalDto {
      @IsOptional()
      @ValidateIf(async () => {
        predicateRuns += 1;
        return true;
      })
      @IsString()
      name: string | null = null;
    }
    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new OptionalConditionalDto(), OptionalConditionalDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
    expect(predicateRuns).toBe(0);
  });

  it('requires null and undefined field values when IsDefined is present', async () => {
    // Given
    class RequiredDto {
      @IsDefined()
      @IsString()
      nullName: string | null = null;

      @IsDefined()
      @IsString()
      undefinedName: string | undefined = undefined;
    }
    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new RequiredDto(), RequiredDto);

    // Then
    await expect(validation).rejects.toMatchObject({
      issues: [
        { code: 'REQUIRED', field: 'nullName', message: 'nullName is required.' },
        { code: 'REQUIRED', field: 'undefinedName', message: 'undefinedName is required.' },
      ],
    });
  });

  it('retains safe own enumerable extra properties during materialization', async () => {
    // Given
    class MigrationDto {
      @IsString()
      name = '';
    }
    const validator = new DefaultValidator();
    const payload = {
      migrationMarker: 'retained-extra-property',
      name: 'fluo',
    };

    // When
    const result = await validator.materialize(payload, MigrationDto);

    // Then
    expect(Object.hasOwn(result, 'migrationMarker')).toBe(true);
    expect(Reflect.get(result, 'migrationMarker')).toBe('retained-extra-property');
  });
});
