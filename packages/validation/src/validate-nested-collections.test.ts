import { describe, expect, it } from 'vitest';

import { MinLength, ValidateNested } from './decorators.js';
import { DefaultValidator } from './validation.js';

class CollectionChildDto {
  @MinLength(2, { message: 'child name must have length at least 2' })
  name = '';
}

class CollectionParentDto {
  @ValidateNested(() => CollectionChildDto)
  childArray: Array<CollectionChildDto | { name: string }> = [];

  @ValidateNested(() => CollectionChildDto)
  childSet = new Set<CollectionChildDto | { name: string }>();

  @ValidateNested(() => CollectionChildDto)
  childMap = new Map<string, CollectionChildDto | { name: string }>();
}

describe('ValidateNested collection contract', () => {
  it('materializes nested array members without each true', async () => {
    // Given
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<CollectionParentDto>(
      { childArray: [{ name: 'array-child' }] },
      CollectionParentDto,
    );

    // Then
    expect(result.childArray[0]).toBeInstanceOf(CollectionChildDto);
  });

  it('materializes nested Set members without each true', async () => {
    // Given
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<CollectionParentDto>(
      { childSet: new Set([{ name: 'set-child' }]) },
      CollectionParentDto,
    );

    // Then
    expect(Array.from(result.childSet)[0]).toBeInstanceOf(CollectionChildDto);
  });

  it('materializes nested Map values without each true', async () => {
    // Given
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<CollectionParentDto>(
      { childMap: new Map([['child', { name: 'map-child' }]]) },
      CollectionParentDto,
    );

    // Then
    expect(result.childMap.get('child')).toBeInstanceOf(CollectionChildDto);
  });

  it('reports invalid nested array members without each true', async () => {
    // Given
    const validator = new DefaultValidator();
    const parent = Object.assign(new CollectionParentDto(), {
      childArray: [{ name: 'valid' }, { name: 'x' }],
    });

    // When / Then
    await expect(validator.validate(parent, CollectionParentDto)).rejects.toMatchObject({
      issues: [{ field: 'childArray[1].name', message: 'child name must have length at least 2' }],
    });
  });

  it('reports invalid nested Set members without each true', async () => {
    // Given
    const validator = new DefaultValidator();
    const parent = Object.assign(new CollectionParentDto(), {
      childSet: new Set([{ name: 'valid' }, { name: 'x' }]),
    });

    // When / Then
    await expect(validator.validate(parent, CollectionParentDto)).rejects.toMatchObject({
      issues: [{ field: 'childSet[1].name', message: 'child name must have length at least 2' }],
    });
  });

  it('reports invalid nested Map values without each true', async () => {
    // Given
    const validator = new DefaultValidator();
    const parent = Object.assign(new CollectionParentDto(), {
      childMap: new Map([
        ['valid', { name: 'valid' }],
        ['invalid', { name: 'x' }],
      ]),
    });

    // When / Then
    await expect(validator.validate(parent, CollectionParentDto)).rejects.toMatchObject({
      issues: [{ field: 'childMap[1].name', message: 'child name must have length at least 2' }],
    });
  });
});
