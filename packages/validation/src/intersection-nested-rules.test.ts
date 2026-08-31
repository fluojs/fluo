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
});
