import { describe, expect, it } from 'vitest';

import { IsNumber, IsString, ValidateNested } from './decorators.js';
import { IntersectionType } from './mapped-types.js';
import { DefaultValidator } from './validation.js';

describe('IntersectionType nested rules', () => {
  it('materializes when source DTOs share a property with different nested rules', async () => {
    // Given
    class NamedChildDto {
      @IsString()
      name = '';
    }

    class RankedChildDto {
      @IsNumber()
      rank = 0;
    }

    class NamedParentDto {
      @ValidateNested(() => NamedChildDto)
      child = new NamedChildDto();
    }

    class RankedParentDto {
      @ValidateNested(() => RankedChildDto)
      child = new RankedChildDto();
    }

    class CombinedParentDto extends IntersectionType(NamedParentDto, RankedParentDto) {}
    const validator = new DefaultValidator();

    // When
    const result = validator.materialize({ child: { name: 'fluo', rank: 1 } }, CombinedParentDto);

    // Then
    await expect(result).resolves.toMatchObject({ child: { name: 'fluo', rank: 1 } });
  });

  it.each([
    {
      child: { name: 123, rank: 1 },
      issues: [{ field: 'child.name', code: 'INVALID_STRING' }],
      scenario: 'only name is invalid',
    },
    {
      child: { name: 'fluo', rank: 'invalid' },
      issues: [{ field: 'child.rank', code: 'INVALID_NUMBER' }],
      scenario: 'only rank is invalid',
    },
    {
      child: { name: 123, rank: 'invalid' },
      issues: [
        { field: 'child.name', code: 'INVALID_STRING' },
        { field: 'child.rank', code: 'INVALID_NUMBER' },
      ],
      scenario: 'both name and rank are invalid',
    },
  ])('rejects shared nested values with exact target issues when $scenario', async ({ child, issues }) => {
    // Given
    class NamedChildDto {
      @IsString()
      name = '';
    }

    class RankedChildDto {
      @IsNumber()
      rank = 0;
    }

    class NamedParentDto {
      @ValidateNested(() => NamedChildDto)
      child = new NamedChildDto();
    }

    class RankedParentDto {
      @ValidateNested(() => RankedChildDto)
      child = new RankedChildDto();
    }

    class CombinedParentDto extends IntersectionType(NamedParentDto, RankedParentDto) {}
    const validator = new DefaultValidator();

    // When
    const result = validator.materialize({ child }, CombinedParentDto);

    // Then
    await expect(result).rejects.toMatchObject({ issues });
  });

  it('reports only genuinely undeclared nested fields in strict mode for different nested targets', async () => {
    // Given
    class NamedChildDto {
      @IsString()
      name = '';
    }

    class RankedChildDto {
      @IsNumber()
      rank = 0;
    }

    class NamedParentDto {
      @ValidateNested(() => NamedChildDto)
      child = new NamedChildDto();
    }

    class RankedParentDto {
      @ValidateNested(() => RankedChildDto)
      child = new RankedChildDto();
    }

    class CombinedParentDto extends IntersectionType(NamedParentDto, RankedParentDto) {}
    const validator = new DefaultValidator();

    // When
    const result = validator.materialize(
      { child: { extra: true, name: 'fluo', rank: 1 } },
      CombinedParentDto,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(result).rejects.toMatchObject({
      issues: [
        {
          code: 'UNDECLARED_PROPERTY',
          field: 'child.extra',
          message: 'child.extra is not declared by the DTO.',
        },
      ],
    });
  });
});
