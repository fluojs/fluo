import { describe, expect, it } from 'vitest';

import {
  defineDtoFieldBindingMetadata,
  getDtoBindingSchema,
  getDtoFieldBindingMetadata,
} from '@fluojs/core/internal';

import { IsEmail, IsString, ValidateClass } from './decorators.js';
import { IntersectionType, OmitType, PartialType, PickType } from './mapped-types.js';
import { DefaultValidator } from './validation.js';

describe('mapped DTO helpers', () => {
  it('PickType initializes only the selected keys on the derived instance', () => {
    class UserDto {
      name = 'Fluo';
      email = 'hello@example.com';
    }

    const UserEmailDto = PickType(UserDto, ['email']);

    expect(UserEmailDto.name).toBe('UserDtoPickType');
    expect(new UserEmailDto()).toEqual({ email: undefined });
  });

  it('OmitType removes omitted keys from the derived initializer', () => {
    class UserDto {
      name = 'Fluo';
      email = 'hello@example.com';
      passwordHash = 'secret';
    }

    const PublicUserDto = OmitType(UserDto, ['passwordHash']);

    expect(PublicUserDto.name).toBe('UserDtoOmitType');
    expect(new PublicUserDto()).toEqual({ email: undefined, name: undefined });
  });

  it('PartialType initializes every base key as undefined for patch-style DTOs', () => {
    class CreateUserDto {
      email = 'hello@example.com';
      name = 'Fluo';
    }

    const UpdateUserDto = PartialType(CreateUserDto);

    expect(UpdateUserDto.name).toBe('CreateUserDtoPartialType');
    expect(new UpdateUserDto()).toEqual({ email: undefined, name: undefined });
    expect(new CreateUserDto()).toEqual({ email: 'hello@example.com', name: 'Fluo' });
  });

  it('IntersectionType merges keys from every base DTO into one derived initializer', () => {
    class PagingDto {
      cursor = 'next';
    }

    class SearchDto {
      query = 'fluo';
    }

    class FilterDto {
      scope = 'public';
    }

    const SearchPageDto = IntersectionType(PagingDto, SearchDto, FilterDto);

    expect(SearchPageDto.name).toBe('PagingDtoSearchDtoFilterDtoIntersectionType');
    expect(new SearchPageDto()).toEqual({ cursor: undefined, query: undefined, scope: undefined });
  });

  it('preserves selected validation metadata on mapped DTO helpers', async () => {
    class UserDto {
      @IsString()
      name = '';

      @IsEmail()
      email = '';
    }

    const UserEmailDto = PickType(UserDto, ['email']);
    const PublicUserDto = OmitType(UserDto, ['email']);
    const validator = new DefaultValidator();

    await expect(validator.materialize({ email: 'not-an-email' }, UserEmailDto)).rejects.toMatchObject({
      issues: [{ code: 'EMAIL', field: 'email', message: 'email is invalid.' }],
    });

    await expect(validator.materialize({ email: 'not-an-email', name: 'Fluo' }, PublicUserDto)).resolves.toMatchObject({
      name: 'Fluo',
    });
  });

  it('preserves field metadata when documented mapped DTO subclassing patterns are used', async () => {
    class UserDto {
      @IsString()
      name = '';

      @IsEmail()
      email = '';
    }

    class UserEmailDto extends PickType(UserDto, ['email']) {}
    class UpdateUserDto extends PartialType(UserDto) {}

    const validator = new DefaultValidator();

    await expect(validator.materialize({ email: 'not-an-email' }, UserEmailDto)).rejects.toMatchObject({
      issues: [{ code: 'EMAIL', field: 'email', message: 'email is invalid.' }],
    });

    await expect(validator.materialize({}, UpdateUserDto)).resolves.toBeInstanceOf(UpdateUserDto);
  });

  it('preserves binding metadata on mapped DTO subclasses', () => {
    class TrimConverter {
      convert(value: unknown) {
        return value;
      }
    }

    class UserDto {
      id = '';
      email = '';
      passwordHash = '';
    }

    class PagingDto {
      cursor = '';
    }

    defineDtoFieldBindingMetadata(UserDto.prototype, 'id', {
      key: 'userId',
      source: 'path',
    });
    defineDtoFieldBindingMetadata(UserDto.prototype, 'email', {
      converter: TrimConverter,
      key: 'email',
      source: 'body',
    });
    defineDtoFieldBindingMetadata(UserDto.prototype, 'passwordHash', {
      key: 'passwordHash',
      source: 'body',
    });
    defineDtoFieldBindingMetadata(PagingDto.prototype, 'cursor', {
      key: 'cursor',
      optional: true,
      source: 'query',
    });

    class UserEmailDto extends PickType(UserDto, ['email']) {}
    class PublicUserDto extends OmitType(UserDto, ['passwordHash']) {}
    class UpdateUserDto extends PartialType(UserDto) {}
    class UserPageDto extends IntersectionType(UserDto, PagingDto) {}

    expect(getDtoFieldBindingMetadata(UserEmailDto.prototype, 'email')).toEqual({
      converter: TrimConverter,
      key: 'email',
      source: 'body',
    });
    expect(getDtoBindingSchema(UserEmailDto)).toEqual([
      {
        propertyKey: 'email',
        metadata: {
          converter: TrimConverter,
          key: 'email',
          source: 'body',
        },
      },
    ]);

    expect(getDtoFieldBindingMetadata(PublicUserDto.prototype, 'id')).toEqual({
      key: 'userId',
      source: 'path',
    });
    expect(getDtoFieldBindingMetadata(PublicUserDto.prototype, 'passwordHash')).toBeUndefined();
    expect(getDtoBindingSchema(PublicUserDto)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          key: 'userId',
          source: 'path',
        },
      },
      {
        propertyKey: 'email',
        metadata: {
          converter: TrimConverter,
          key: 'email',
          source: 'body',
        },
      },
    ]);

    expect(getDtoFieldBindingMetadata(UpdateUserDto.prototype, 'id')).toEqual({
      key: 'userId',
      optional: true,
      source: 'path',
    });
    expect(getDtoBindingSchema(UpdateUserDto)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          key: 'userId',
          optional: true,
          source: 'path',
        },
      },
      {
        propertyKey: 'email',
        metadata: {
          converter: TrimConverter,
          key: 'email',
          optional: true,
          source: 'body',
        },
      },
      {
        propertyKey: 'passwordHash',
        metadata: {
          key: 'passwordHash',
          optional: true,
          source: 'body',
        },
      },
    ]);

    expect(getDtoFieldBindingMetadata(UserPageDto.prototype, 'cursor')).toEqual({
      key: 'cursor',
      optional: true,
      source: 'query',
    });
    expect(getDtoBindingSchema(UserPageDto)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          key: 'userId',
          source: 'path',
        },
      },
      {
        propertyKey: 'email',
        metadata: {
          converter: TrimConverter,
          key: 'email',
          source: 'body',
        },
      },
      {
        propertyKey: 'passwordHash',
        metadata: {
          key: 'passwordHash',
          source: 'body',
        },
      },
      {
        propertyKey: 'cursor',
        metadata: {
          key: 'cursor',
          optional: true,
          source: 'query',
        },
      },
    ]);
  });

  it('does not copy base class-level validators onto subset or partial DTO helpers', async () => {
    @ValidateClass((dto: unknown) => {
      const value = dto as { confirmEmail?: string; email?: string };
      return value.email === value.confirmEmail
        ? true
        : { code: 'EMAIL_MISMATCH', message: 'email and confirmEmail must match' };
    })
    class UserDto {
      @IsEmail()
      email = '';

      @IsEmail()
      confirmEmail = '';
    }

    class UserEmailDto extends PickType(UserDto, ['email']) {}
    class PublicUserDto extends OmitType(UserDto, ['confirmEmail']) {}
    class UpdateUserDto extends PartialType(UserDto) {}

    const validator = new DefaultValidator();

    await expect(validator.materialize({ email: 'hello@example.com' }, UserEmailDto)).resolves.toBeInstanceOf(UserEmailDto);
    await expect(validator.materialize({ email: 'hello@example.com' }, PublicUserDto)).resolves.toBeInstanceOf(PublicUserDto);
    await expect(validator.materialize({ email: 'hello@example.com' }, UpdateUserDto)).resolves.toBeInstanceOf(UpdateUserDto);
  });
});
