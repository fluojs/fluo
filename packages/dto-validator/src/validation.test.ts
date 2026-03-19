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

  it('transform returns a typed DTO instance from plain object', async () => {
    class CreateUserDto {
      @IsEmail()
      email = '';
    }

    const validator = new DefaultValidator();
    const result = await validator.transform<CreateUserDto>({ email: 'hello@example.com' }, CreateUserDto);

    expect(result).toBeInstanceOf(CreateUserDto);
    expect(result.email).toBe('hello@example.com');
  });

  it('transform recursively transforms nested DTOs', async () => {
    class AddressDto {
      @MinLength(1)
      city = '';
    }

    class CreateOrderDto {
      @ValidateNested(() => AddressDto)
      address = new AddressDto();

      @ValidateNested(() => AddressDto, { each: true })
      previousAddresses: AddressDto[] = [];
    }

    const validator = new DefaultValidator();
    const result = await validator.transform<CreateOrderDto>(
      {
        address: { city: 'Seoul' },
        previousAddresses: [{ city: 'Busan' }],
      },
      CreateOrderDto,
    );

    expect(result).toBeInstanceOf(CreateOrderDto);
    expect(result.address).toBeInstanceOf(AddressDto);
    expect(result.previousAddresses[0]).toBeInstanceOf(AddressDto);
  });

  it('transform throws DtoValidationError on invalid input', async () => {
    class CreateUserDto {
      @IsEmail()
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(validator.transform({ email: 'not-an-email' }, CreateUserDto)).rejects.toBeInstanceOf(DtoValidationError);
  });

  it('resolves lazy circular nested references at validation time', async () => {
    class ParentDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => ChildDto)
      child!: ChildDto;
    }

    class ChildDto {
      @ValidateNested(() => ParentDto, { each: true })
      parents: ParentDto[] = [];
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new ParentDto(), {
          child: {
            parents: [{}],
          },
          name: 'ok',
        }),
        ParentDto,
      ),
    ).rejects.toMatchObject({
      issues: [{ field: 'child.parents[0].name' }],
    });
  });
});
