import { describe, expect, it } from 'vitest';

import { DefaultValidator } from './validation.js';
import { DtoValidationError } from './errors.js';
import { IsEmail, MinLength, ValidateNested } from './decorators.js';

describe('DefaultValidator', () => {
  it('validates basic rules without HTTP bindings', async () => {
    class CreateUserDto {
      @IsEmail({ message: 'email must be valid' })
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateUserDto(), { email: 'bad' }), CreateUserDto),
    ).rejects.toBeInstanceOf(DtoValidationError);
  });

  it('produces nested field paths and indexed paths', async () => {
    class AddressDto {
      @MinLength(1, { message: 'city is required' })
      city = '';
    }

    class ItemDto {
      @MinLength(2, { message: 'item name must have length at least 2' })
      name = '';
    }

    class CreateOrderDto {
      @ValidateNested(() => AddressDto)
      address = new AddressDto();

      @MinLength(2, { each: true, message: 'tag must have length at least 2' })
      tags: string[] = [];

      @ValidateNested(() => ItemDto, { each: true })
      items: ItemDto[] = [];
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new CreateOrderDto(), {
          address: { city: '' },
          items: [{ name: '' }],
          tags: ['ok', 'x'],
        }),
        CreateOrderDto,
      ),
    ).rejects.toMatchObject({
      issues: [
        { field: 'address.city', message: 'city is required' },
        { field: 'tags[1]', message: 'tag must have length at least 2' },
        { field: 'items[0].name', message: 'item name must have length at least 2' },
      ],
    });
  });
});
