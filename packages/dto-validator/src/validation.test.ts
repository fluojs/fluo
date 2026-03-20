import { describe, expect, it } from 'vitest';

import { DefaultValidator } from './validation.js';
import { DtoValidationError } from './errors.js';
import { ArrayUnique, IsEmail, IsNotEmpty, MinLength, Validate, ValidateClass, ValidateIf, ValidateNested } from './decorators.js';

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

  it('transform recursively transforms nested Set and Map DTO collections', async () => {
    class AddressDto {
      @MinLength(1)
      city = '';
    }

    class CreateOrderDto {
      @ValidateNested(() => AddressDto, { each: true })
      previousAddressMap = new Map<string, AddressDto>();

      @ValidateNested(() => AddressDto, { each: true })
      previousAddressSet = new Set<AddressDto>();
    }

    const validator = new DefaultValidator();
    const result = await validator.transform<CreateOrderDto>(
      {
        previousAddressMap: new Map<string, { city: string }>([['home', { city: 'Seoul' }]]),
        previousAddressSet: new Set([{ city: 'Busan' }]),
      },
      CreateOrderDto,
    );

    expect(result).toBeInstanceOf(CreateOrderDto);
    expect(result.previousAddressMap).toBeInstanceOf(Map);
    expect(result.previousAddressSet).toBeInstanceOf(Set);
    expect(result.previousAddressMap.get('home')).toBeInstanceOf(AddressDto);
    expect(Array.from(result.previousAddressSet)[0]).toBeInstanceOf(AddressDto);
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

  it('skips dependent validators when the ValidateIf condition is false', async () => {
    class ConditionalDto {
      enabled = false;

      @ValidateIf((dto) => (dto as ConditionalDto).enabled)
      @MinLength(3, { message: 'code must have length at least 3' })
      code = '';

      @ValidateIf(() => false)
      @IsNotEmpty({ message: 'note must not be empty' })
      note = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new ConditionalDto(), {
          code: 'x',
          enabled: false,
          note: '',
        }),
        ConditionalDto,
      ),
    ).resolves.toBeUndefined();
  });

  it('runs dependent validators when the ValidateIf condition is true', async () => {
    class ConditionalDto {
      enabled = false;

      @ValidateIf((dto) => (dto as ConditionalDto).enabled)
      @MinLength(3, { message: 'code must have length at least 3' })
      code = '';

      @ValidateIf(() => false)
      @IsNotEmpty({ message: 'note must not be empty' })
      note = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new ConditionalDto(), {
          code: 'x',
          enabled: true,
          note: 'ok',
        }),
        ConditionalDto,
      ),
    ).rejects.toMatchObject({
      issues: [{ field: 'code', message: 'code must have length at least 3' }],
    });
  });

  it('checks ArrayUnique selector-based comparisons', async () => {
    class UniqueItemsDto {
      @ArrayUnique((value: unknown) => (value as { id: string }).id, { message: 'items must have unique id' })
      items: Array<{ id: string }> = [];
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new UniqueItemsDto(), {
          items: [{ id: 'a' }, { id: 'a' }],
        }),
        UniqueItemsDto,
      ),
    ).rejects.toMatchObject({
      issues: [{ field: 'items', message: 'items must have unique id' }],
    });
  });

  it('supports each validation for Set and Map values', async () => {
    class CollectionDto {
      @MinLength(2, { each: true, message: 'set value must have length at least 2' })
      tagsSet = new Set<string>();

      @MinLength(2, { each: true, message: 'map value must have length at least 2' })
      tagsMap = new Map<string, string>();
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new CollectionDto(), {
          tagsMap: new Map<string, string>([
            ['a', 'ok'],
            ['b', 'x'],
          ]),
          tagsSet: new Set<string>(['ok', 'x']),
        }),
        CollectionDto,
      ),
    ).rejects.toMatchObject({
      issues: [
        { field: 'tagsSet[1]', message: 'set value must have length at least 2' },
        { field: 'tagsMap[1]', message: 'map value must have length at least 2' },
      ],
    });
  });

  it('supports custom validators with each over Set and Map', async () => {
    class CustomEachDto {
      @Validate((value: unknown) => (typeof value === 'string' && value.startsWith('ok') ? true : false), {
        code: 'CUSTOM_PREFIX',
        each: true,
        message: 'entry must start with ok',
      })
      entries = new Set<string>();

      @Validate((value: unknown) => (typeof value === 'number' && value > 0 ? true : false), {
        code: 'CUSTOM_POSITIVE',
        each: true,
        message: 'count must be positive',
      })
      counts = new Map<string, number>();
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new CustomEachDto(), {
          counts: new Map<string, number>([
            ['ok', 1],
            ['bad', 0],
          ]),
          entries: new Set<string>(['ok-a', 'bad']),
        }),
        CustomEachDto,
      ),
    ).rejects.toMatchObject({
      issues: [
        { code: 'CUSTOM_PREFIX', field: 'entries[1]', message: 'entry must start with ok' },
        { code: 'CUSTOM_POSITIVE', field: 'counts[1]', message: 'count must be positive' },
      ],
    });
  });

  it('supports class-level custom validators', async () => {
    @ValidateClass((dto: unknown) => {
      const value = dto as MatchingNamesDto;
      return value.name === value.confirmName
        ? true
        : { code: 'NAMES_MISMATCH', message: 'name and confirmName must match' };
    })
    class MatchingNamesDto {
      @MinLength(1)
      name = '';

      @MinLength(1)
      confirmName = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new MatchingNamesDto(), {
          confirmName: 'jane',
          name: 'john',
        }),
        MatchingNamesDto,
      ),
    ).rejects.toMatchObject({
      issues: [{ code: 'NAMES_MISMATCH', message: 'name and confirmName must match' }],
    });
  });
});
