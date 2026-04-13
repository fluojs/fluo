import { describe, expect, it } from 'vitest';

import { IntersectionType, OmitType, PartialType, PickType } from './mapped-types.js';

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
});
