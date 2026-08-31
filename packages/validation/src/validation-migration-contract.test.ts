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

  it('reports dot paths for undeclared properties in nested plain DTO values', async () => {
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
          field: 'child.nestedMarker',
          message: 'child.nestedMarker is not declared by the DTO.',
        },
      ],
    });
  });

  it('reports indexed paths for undeclared properties in nested Array DTO values', async () => {
    // Given
    class ChildDto {
      @IsString()
      name = '';
    }
    class ParentDto {
      @ValidateNested(ChildDto)
      items: Array<ChildDto | { name: string; nestedMarker: string }> = [];
    }
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(
      { items: [{ name: 'fluo', nestedMarker: 'undeclared' }] },
      ParentDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(materialization).rejects.toMatchObject({
      issues: [{
        code: 'UNDECLARED_PROPERTY',
        field: 'items[0].nestedMarker',
        message: 'items[0].nestedMarker is not declared by the DTO.',
      }],
    });
  });

  it('reports indexed paths for undeclared properties in nested Set DTO values', async () => {
    // Given
    class ChildDto {
      @IsString()
      name = '';
    }
    class ParentDto {
      @ValidateNested(ChildDto)
      items = new Set<ChildDto | { name: string; nestedMarker: string }>();
    }
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(
      { items: new Set([{ name: 'fluo', nestedMarker: 'undeclared' }]) },
      ParentDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(materialization).rejects.toMatchObject({
      issues: [{
        code: 'UNDECLARED_PROPERTY',
        field: 'items[0].nestedMarker',
        message: 'items[0].nestedMarker is not declared by the DTO.',
      }],
    });
  });

  it('reports indexed paths for undeclared properties in nested Map DTO values', async () => {
    // Given
    class ChildDto {
      @IsString()
      name = '';
    }
    class ParentDto {
      @ValidateNested(ChildDto)
      items = new Map<string, ChildDto | { name: string; nestedMarker: string }>();
    }
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(
      { items: new Map([['child', { name: 'fluo', nestedMarker: 'undeclared' }]]) },
      ParentDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(materialization).rejects.toMatchObject({
      issues: [{
        code: 'UNDECLARED_PROPERTY',
        field: 'items[0].nestedMarker',
        message: 'items[0].nestedMarker is not declared by the DTO.',
      }],
    });
  });

  it('accepts inherited DTO fields and inherited binding aliases in reject mode', async () => {
    // Given
    class BaseDto {
      @IsString()
      inheritedName = '';
    }
    defineDtoFieldBindingMetadata(BaseDto.prototype, 'inheritedName', {
      key: 'inherited_name',
      source: 'body',
    });
    class DerivedDto extends BaseDto {
      @IsString()
      localName = '';
    }
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(
      { inheritedName: 'direct', inherited_name: 'alias', localName: 'local' },
      DerivedDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(materialization).resolves.toMatchObject({
      inheritedName: 'alias',
      localName: 'local',
    });
  });

  it('rejects only safe own enumerable extras in reject mode', async () => {
    // Given
    class StrictDto {
      @IsString()
      name = '';
    }
    const payload: Record<string, unknown> = { name: 'fluo', safeMarker: 'undeclared' };
    Object.defineProperty(payload, '__proto__', { enumerable: true, value: { polluted: true } });
    Object.defineProperty(payload, 'constructor', { enumerable: true, value: { polluted: true } });
    Object.defineProperty(payload, 'prototype', { enumerable: true, value: { polluted: true } });
    const validator = new DefaultValidator();

    // When
    const materialization = validator.materialize(payload, StrictDto, { undeclaredProperties: 'reject' });

    // Then
    await expect(materialization).rejects.toMatchObject({
      issues: [{
        code: 'UNDECLARED_PROPERTY',
        field: 'safeMarker',
        message: 'safeMarker is not declared by the DTO.',
      }],
    });
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('ignores dangerous and non-enumerable own properties without prototype pollution', async () => {
    // Given
    class StrictDto {
      @IsString()
      name = '';
    }
    const payload: Record<string, unknown> = { name: 'fluo' };
    Object.defineProperty(payload, '__proto__', { enumerable: true, value: { polluted: true } });
    Object.defineProperty(payload, 'constructor', { enumerable: true, value: { polluted: true } });
    Object.defineProperty(payload, 'prototype', { enumerable: true, value: { polluted: true } });
    Object.defineProperty(payload, 'hiddenMarker', { enumerable: false, value: 'ignored' });
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<StrictDto>(payload, StrictDto, { undeclaredProperties: 'reject' });

    // Then
    expect(Object.getPrototypeOf(result)).toBe(StrictDto.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
    expect(Object.hasOwn(result, 'constructor')).toBe(false);
    expect(Object.hasOwn(result, 'prototype')).toBe(false);
    expect(Object.hasOwn(result, 'hiddenMarker')).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

});
