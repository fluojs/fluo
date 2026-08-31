import { defineDtoFieldBindingMetadata } from '@fluojs/core/request-pipeline';
import { describe, expect, it } from 'vitest';

import { IsDefined, IsString, ValidateNested } from './decorators.js';
import { DefaultValidator } from './validation.js';

describe('validation migration contract', () => {
  it('skips ordinary validators for null and undefined field values', async () => {
    // Given
    class OptionalByAbsenceDto {
      @IsString()
      nullableName: string | null = null;

      @IsString()
      undefinedName: string | undefined = undefined;
    }
    const validator = new DefaultValidator();

    // When
    const validation = validator.validate(new OptionalByAbsenceDto(), OptionalByAbsenceDto);

    // Then
    await expect(validation).resolves.toBeUndefined();
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

  it('rejects undeclared properties while accepting DTO fields and binding aliases when opted in', async () => {
    // Given
    class StrictDto {
      @IsString()
      userId = '';
    }
    defineDtoFieldBindingMetadata(StrictDto.prototype, 'userId', {
      key: 'id',
      source: 'path',
    });
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(
      { id: 'user-123', migrationMarker: 'undeclared' },
      StrictDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(materialization).rejects.toMatchObject({
      issues: [
        {
          code: 'UNDECLARED_PROPERTY',
          field: 'migrationMarker',
          message: 'migrationMarker is not declared by the DTO.',
        },
      ],
    });
  });

  it('accepts DTO fields and binding aliases as declared properties when rejection is opted in', async () => {
    // Given
    class StrictDto {
      @IsString()
      userId = '';
    }
    defineDtoFieldBindingMetadata(StrictDto.prototype, 'userId', {
      key: 'id',
      source: 'path',
    });
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(
      { id: 'user-123', userId: 'direct-user-id' },
      StrictDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(materialization).resolves.toMatchObject({ userId: 'user-123' });
  });

  it('rejects undeclared properties in nested plain DTO values when opted in', async () => {
    // Given
    class ChildDto {
      @IsString()
      name = '';
    }
    class ParentDto {
      @ValidateNested(ChildDto)
      child = new ChildDto();
    }
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(
      { child: { name: 'fluo', nestedMarker: 'undeclared' } },
      ParentDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(materialization).rejects.toMatchObject({
      issues: [
        {
          code: 'UNDECLARED_PROPERTY',
          field: 'nestedMarker',
          message: 'nestedMarker is not declared by the DTO.',
        },
      ],
    });
  });

});
