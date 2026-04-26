import { type } from 'arktype';
import { email, object, pipe, string } from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DefaultValidator } from './validation.js';
import { DtoValidationError } from './errors.js';
import { ArrayUnique, IsDateString, IsEmail, IsNotEmpty, MinLength, Validate, ValidateClass, ValidateIf, ValidateNested } from './decorators.js';
import type { StandardSchemaV1Like } from './index.js';

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

  it('treats IsDateString as an ISO-8601 validator', async () => {
    class CreateScheduleDto {
      @IsDateString({ message: 'scheduledAt must be a valid ISO-8601 date string' })
      scheduledAt = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateScheduleDto(), { scheduledAt: '2026-03-30T10:00:00.000Z' }), CreateScheduleDto),
    ).resolves.toBeUndefined();

    await expect(
      validator.validate(Object.assign(new CreateScheduleDto(), { scheduledAt: 'March 30, 2026' }), CreateScheduleDto),
    ).rejects.toMatchObject({
      issues: [{ field: 'scheduledAt', message: 'scheduledAt must be a valid ISO-8601 date string' }],
    });
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

  it('materialize returns a typed DTO instance from plain object', async () => {
    class CreateUserDto {
      @IsEmail()
      email = '';
    }

    const validator = new DefaultValidator();
    const result = await validator.materialize<CreateUserDto>({ email: 'hello@example.com' }, CreateUserDto);

    expect(result).toBeInstanceOf(CreateUserDto);
    expect(result.email).toBe('hello@example.com');
  });

  it('materialize recursively hydrates nested DTOs', async () => {
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
    const result = await validator.materialize<CreateOrderDto>(
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

  it('materialize recursively hydrates nested Set and Map DTO collections', async () => {
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
    const result = await validator.materialize<CreateOrderDto>(
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

  it('rejects non-plain nested input during materialize', async () => {
    class ChildDto {}

    class ParentDto {
      @ValidateNested(() => ChildDto)
      child = new ChildDto();
    }

    const validator = new DefaultValidator();
    await expect(
      validator.materialize<ParentDto>(
        {
          child: 'unsafe-string-input',
        },
        ParentDto,
      ),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'child', message: 'child contains invalid nested data.' }],
    });
  });

  it('rejects non-plain object instances for nested validation', async () => {
    class ChildDto {}

    class ParentDto {
      @ValidateNested(() => ChildDto)
      child = new ChildDto();
    }

    class UnsafeChildInput {
      city = 'Seoul';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new ParentDto(), {
          child: new UnsafeChildInput(),
        }),
        ParentDto,
      ),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'child', message: 'child contains invalid nested data.' }],
    });
  });

  it('rejects non-plain nested entries across array, set, and map collections', async () => {
    class ChildDto {}

    class ParentDto {
      @ValidateNested(() => ChildDto, { each: true })
      childArray: ChildDto[] = [];

      @ValidateNested(() => ChildDto, { each: true })
      childSet = new Set<ChildDto>();

      @ValidateNested(() => ChildDto, { each: true })
      childMap = new Map<string, ChildDto>();
    }

    class UnsafeChildInput {
      city = 'Seoul';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.materialize<ParentDto>(
        {
          childArray: [new UnsafeChildInput()],
          childMap: new Map([['home', new UnsafeChildInput()]]),
          childSet: new Set([new UnsafeChildInput()]),
        },
        ParentDto,
      ),
    ).rejects.toMatchObject({
      issues: [
        { code: 'INVALID_NESTED', field: 'childArray[0]', message: 'childArray[0] contains invalid nested data.' },
        { code: 'INVALID_NESTED', field: 'childSet[0]', message: 'childSet[0] contains invalid nested data.' },
        { code: 'INVALID_NESTED', field: 'childMap[0]', message: 'childMap[0] contains invalid nested data.' },
      ],
    });
  });

  it('ignores dangerous keys when materializing nested DTO instances', async () => {
    class ChildDto {
      @MinLength(1)
      city = '';
    }

    class ParentDto {
      @ValidateNested(() => ChildDto)
      child = new ChildDto();
    }

    const validator = new DefaultValidator();
    const payload = JSON.parse('{"child":{"city":"Seoul","__proto__":{"polluted":true}}}') as {
      child: { city: string; __proto__: { polluted: boolean } };
    };

    const result = await validator.materialize<ParentDto>(payload, ParentDto);

    expect(result.child).toBeInstanceOf(ChildDto);
    expect(result.child.city).toBe('Seoul');
    expect(Object.getPrototypeOf(result.child)).toBe(ChildDto.prototype);
    expect('polluted' in (result.child as object)).toBe(false);
  });

  it('materialize throws DtoValidationError on invalid input', async () => {
    class CreateUserDto {
      @IsEmail()
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(validator.materialize({ email: 'not-an-email' }, CreateUserDto)).rejects.toBeInstanceOf(DtoValidationError);
  });

  it('preserves DtoValidationError prototype identity', () => {
    const error = new DtoValidationError('Validation failed.', []);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DtoValidationError);
    expect(Object.getPrototypeOf(error)).toBe(DtoValidationError.prototype);
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

  it('rejects cyclic nested payloads during validation instead of recursing indefinitely', async () => {
    class NodeDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => NodeDto)
      child?: NodeDto;
    }

    const validator = new DefaultValidator();
    const payload: { child?: unknown; name: string } = { name: 'root' };
    payload.child = payload;

    await expect(
      validator.validate(Object.assign(new NodeDto(), payload), NodeDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'child.child', message: 'child.child contains invalid nested data.' }],
    });
  });

  it('rejects cyclic nested payloads during materialize instead of recursing indefinitely', async () => {
    class NodeDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => NodeDto)
      child?: NodeDto;
    }

    const validator = new DefaultValidator();
    const payload: { child?: unknown; name: string } = { name: 'root' };
    payload.child = payload;

    await expect(
      validator.materialize<NodeDto>(payload, NodeDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'child.child', message: 'child.child contains invalid nested data.' }],
    });
  });

  it('rejects cyclic DTO instances during validation instead of recursing indefinitely', async () => {
    class NodeDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => NodeDto)
      child?: NodeDto;
    }

    const validator = new DefaultValidator();
    const root = Object.assign(new NodeDto(), { name: 'root' });
    root.child = root;

    await expect(
      validator.validate(root, NodeDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'child', message: 'child contains invalid nested data.' }],
    });
  });

  it('rejects cyclic nested collection entries during validation instead of recursing indefinitely', async () => {
    class NodeDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => NodeDto, { each: true })
      children: NodeDto[] = [];
    }

    const validator = new DefaultValidator();
    const root = Object.assign(new NodeDto(), { name: 'root' });
    root.children = [root];

    await expect(
      validator.validate(root, NodeDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'children[0]', message: 'children[0] contains invalid nested data.' }],
    });
  });

  it('allows shared nested payload objects across sibling fields', async () => {
    class ChildDto {
      @MinLength(1)
      name = '';
    }

    class ParentDto {
      @ValidateNested(() => ChildDto)
      left = new ChildDto();

      @ValidateNested(() => ChildDto)
      right = new ChildDto();
    }

    const shared = { name: 'ok' };
    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new ParentDto(), {
          left: shared,
          right: shared,
        }),
        ParentDto,
      ),
    ).resolves.toBeUndefined();
  });

  it('allows shared nested payload objects across collection entries', async () => {
    class ChildDto {
      @MinLength(1)
      name = '';
    }

    class ParentDto {
      @ValidateNested(() => ChildDto, { each: true })
      children: ChildDto[] = [];
    }

    const shared = { name: 'ok' };
    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new ParentDto(), {
          children: [shared, shared],
        }),
        ParentDto,
      ),
    ).resolves.toBeUndefined();
  });

  it('reports stable field paths for deeply nested DTO validation failures', async () => {
    class Level3Dto {
      @MinLength(2, { message: 'leaf must have length at least 2' })
      leaf = '';
    }

    class Level2Dto {
      @ValidateNested(() => Level3Dto)
      level3 = new Level3Dto();
    }

    class Level1Dto {
      @ValidateNested(() => Level2Dto, { each: true })
      items: Level2Dto[] = [];
    }

    class RootDto {
      @ValidateNested(() => Level1Dto)
      level1 = new Level1Dto();
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(
        Object.assign(new RootDto(), {
          level1: {
            items: [{ level3: { leaf: 'x' } }],
          },
        }),
        RootDto,
      ),
    ).rejects.toMatchObject({
      issues: [{ field: 'level1.items[0].level3.leaf', message: 'leaf must have length at least 2' }],
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
      @Validate((value: unknown) => !!(typeof value === 'string' && value.startsWith('ok')), {
        code: 'CUSTOM_PREFIX',
        each: true,
        message: 'entry must start with ok',
      })
      entries = new Set<string>();

      @Validate((value: unknown) => !!(typeof value === 'number' && value > 0), {
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

  it('supports class-level Standard Schema validators with Zod', async () => {
    @ValidateClass(
      z.object({
        email: z.string().email(),
      }),
    )
    class CreateUserDto {
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateUserDto(), { email: 'bad' }), CreateUserDto),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'INVALID_FORMAT', field: 'email' })],
    });
  });

  it('supports class-level Standard Schema validators with Valibot', async () => {
    @ValidateClass(
      object({
        email: pipe(string(), email()),
      }),
    )
    class CreateUserDto {
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateUserDto(), { email: 'hello@fluo.dev' }), CreateUserDto),
    ).resolves.toBeUndefined();
  });

  it('supports class-level Standard Schema validators with ArkType function schemas', async () => {
    @ValidateClass(
      type({
        email: 'string.email',
      }),
    )
    class CreateUserDto {
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateUserDto(), { email: 'bad' }), CreateUserDto),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
    });
  });

  it('accepts the public StandardSchemaV1Like type for class-level DTO validation', async () => {
    const schema: StandardSchemaV1Like<{ email: string }> = {
      '~standard': {
        validate: async (value) => {
          if (
            typeof value === 'object'
            && value !== null
            && 'email' in value
            && typeof value.email === 'string'
            && value.email === 'hello@fluo.dev'
          ) {
            return { value: { email: value.email } };
          }

          return {
            issues: [
              {
                message: 'email must match the public schema contract',
                path: ['email'],
              },
            ],
          };
        },
        vendor: 'test',
        version: 1,
      },
    };

    @ValidateClass(schema)
    class CreateUserDto {
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateUserDto(), { email: 'bad' }), CreateUserDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_FIELD', field: 'email', message: 'email must match the public schema contract' }],
    });
  });

  it('treats empty Standard Schema issues as a successful validation result', async () => {
    @ValidateClass({
      '~standard': {
        validate: async () => ({ issues: [] }),
        vendor: 'test',
        version: 1,
      },
    })
    class CreateUserDto {
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateUserDto(), { email: 'hello@fluo.dev' }), CreateUserDto),
    ).resolves.toBeUndefined();
  });

  it('rejects malformed Standard Schema issues payloads explicitly', async () => {
    @ValidateClass({
      '~standard': {
        validate: async () => ({ issues: 'bad-result' }) as never,
        vendor: 'test',
        version: 1,
      },
    })
    class CreateUserDto {
      email = '';
    }

    const validator = new DefaultValidator();

    await expect(
      validator.validate(Object.assign(new CreateUserDto(), { email: 'hello@fluo.dev' }), CreateUserDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_SCHEMA_RESULT', message: 'Standard Schema validator returned malformed issues.' }],
    });
  });
});
